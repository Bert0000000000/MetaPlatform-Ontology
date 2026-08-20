// supabase/functions/mp-sandbox/index.ts
// PRD: docs/active/prd/mp-sandbox.md
// ADR:  docs/active/decisions/ADR-0069-mp-sandbox-poc.md
// Batch: MetaPlatform.1-MP-SANDBOX-01 (Issue #15 production path §3 — Loop 1/3)
// Issue: #15 (mp-sandbox 完整生产路径)
//
// 安全代码执行沙箱 (PoC → 生产切换 Loop 1/3)
//
// Loop 1 (this commit): mp_sandbox.executions 表 + RLS + EF 直接 INSERT (同时保留
//   public.record_execution RPC 写 audit_log 语义 SANDBOX_* 动作, 后续 loop 删).
//
// 生产完整路径 (ADR-0069 §3):
//   - sync  (<30s): sidecar in mp-runtime Deployment, 用 bwrap / Landlock
//   - async (K8s Job): mp-ai namespace, Job template 动态生成
//
// **PoC 警示**: 当前 mockExecute 是 stub — 用 setTimeout 模拟执行,
// 严禁生产用. 真实代码执行需要 sidecar bwrap / Landlock 强制隔离.
// 本 EF 在生产路径到位前仅用于:
//   1. 走通 HTTP contract (request/response shape + 错误码 + audit_log)
//   2. 验证黑白名单过滤逻辑
//   3. 给 mp-agent-team / mp-ontology 留一个稳定的对接面

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

// -----------------------------------------------------------------------------
// 危险命令黑白名单 (PoC 阶段静态配置)
// -----------------------------------------------------------------------------
//
// 任意 "已知会搞坏主机" 的命令 → blacklist. 后续 PoC 会扩到 dsh sandbox
// package 的可执行清单 (decision §3).
//
// 匹配规则: 大小写不敏感 + 去掉多余空白. 仅基于字面 token 匹配 (不做 AST 解析).
// "rm -rf /" / "rm -rf /*" / "rm -rf /etc" 都应命中.
//

const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-[a-z]*r|-[a-z]*f)[^\n]*\s+\//i, reason: 'recursive forced remove on root filesystem' },
  { pattern: /\brm\s+-[a-z]*r[^\n]*\s+\/(?!\s*tmp)/i, reason: 'recursive remove outside /tmp' },
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: 'filesystem format' },
  { pattern: /\bdd\s+if=/i, reason: 'raw block write' },
  { pattern: /\bdd\s+of=\/dev\//i, reason: 'raw block write to device' },
  { pattern: /:\(\)\s*\{.*:\s*\|\s*:.*\}\s*;?\s*:/i, reason: 'bash fork bomb' },
  { pattern: /\b(?:curl|wget)\s+[^|]*\|\s*(?:bash|sh|zsh)\b/i, reason: 'remote script piped to shell' },
  { pattern: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/i, reason: 'system power control' },
  { pattern: /\biptables\b|\bfirewall\b|\bnft\b/i, reason: 'firewall manipulation' },
  { pattern: /\bchmod\s+(-[a-z]*\s+)?(?:0?777|0?666)\b/i, reason: 'world-writable chmod' },
  { pattern: /\bchown\s+-R?\b[^\n]*\s+\/(?!\s*(?:home|tmp|app)\b)/i, reason: 'recursive chown on system path' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'raw write to disk device' },
];

// 白名单 language → 实际执行器映射 (PoC: 全部走 mock, 生产会替换)
const SUPPORTED_LANGUAGES = new Set(['python', 'javascript', 'bash']);

const MAX_TIMEOUT_MS = 5000;
const MAX_CODE_BYTES = 1_048_576;   // 1 MiB
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ExecuteRequest {
  code: string;
  language: 'python' | 'javascript' | 'bash';
  timeout_ms?: number;
  network?: 'isolated' | 'internet';
}

interface DeniedReason {
  ok: false;
  reason: string;
  pattern_matched: string;
}

interface ExecuteSuccess {
  ok: true;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  language: string;
  mode: 'poc_mock';
  warning: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function denyReason(code: string): DeniedReason | null {
  const stripped = code.replace(/\s+/g, ' ');
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(code) || pattern.test(stripped)) {
      return {
        ok: false,
        reason,
        pattern_matched: pattern.source,
      };
    }
  }
  return null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// recordExecution — Issue #15 Loop 1/3
// -----------------------------------------------------------------------------
// 双写:
//   1. mp_sandbox.executions (structured record, tenant RLS, queryable by mp-audit)
//   2. public.record_execution RPC → audit_log (semantic SANDBOX_* action — Loop 2 删)
// 失败不抛 — 沙箱不能因为审计失败而拒绝用户执行.
async function recordExecution(args: {
  tenantId: string;
  actorId: string;
  action: 'SANDBOX_EXECUTE' | 'SANDBOX_DENIED' | 'SANDBOX_TIMEOUT';
  language: string;
  codeSha: string;
  codeBytes: number;
  timeoutMs: number;
  network: 'isolated' | 'internet';
  exitCode: number | null;
  durationMs: number | null;
  stdoutBytes: number;
  stderrBytes: number;
  mode: 'poc_mock' | 'sidecar_sync' | 'k8s_job_async';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const meta = args.metadata ?? {};

  // 1) mp_sandbox.executions INSERT
  try {
    const { error: insErr } = await sb.schema('mp_sandbox').from('executions').insert({
      tenant_id: args.tenantId,
      actor_id: args.actorId,
      action: args.action,
      language: args.language,
      code_sha256: args.codeSha,
      code_bytes: args.codeBytes,
      timeout_ms: args.timeoutMs,
      network: args.network,
      exit_code: args.exitCode,
      duration_ms: args.durationMs,
      stdout_bytes: args.stdoutBytes,
      stderr_bytes: args.stderrBytes,
      mode: args.mode,
      metadata: meta,
    });
    if (insErr) console.error('[mp-sandbox] executions insert failed:', insErr.message);
  } catch (ex) {
    console.error('[mp-sandbox] executions insert exception:', String(ex));
  }

  // 2) public.record_execution RPC → audit_log semantic SANDBOX_* action
  try {
    const { error: rpcErr } = await sb.schema('mp_sandbox').rpc('record_execution', {
      p_tenant_id: args.tenantId,
      p_actor_id: args.actorId,
      p_action: args.action,
      p_language: args.language,
      p_code_sha256: args.codeSha,
      p_code_bytes: args.codeBytes,
      p_timeout_ms: args.timeoutMs,
      p_network: args.network,
      p_exit_code: args.exitCode,
      p_duration_ms: args.durationMs,
      p_stdout_bytes: args.stdoutBytes,
      p_stderr_bytes: args.stderrBytes,
      p_metadata: meta,
    });
    if (rpcErr) console.error('[mp-sandbox] audit rpc failed:', rpcErr.message);
  } catch (ex) {
    console.error('[mp-sandbox] audit rpc exception:', String(ex));
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// PoC 模拟执行:
//   - echo / console.log / print 拦截: 把 echo 单引号内的字面量写回 stdout
//   - 其他: 输出 "[poc] executed <lang> code (N bytes)"
// 不真起子进程, 不真调 python/node/bash.
//
// PoC timeout 模拟:
//   - 默认 (timeout_ms 5000): 等 ~100ms 模拟 IO 完成, 返回 200
//   - 用户传 timeout_ms ≤ 200: 等满 timeoutMs 触发 abort, 返回 408
//     (用于 E2E test 3 — 让测试可控地拿到 timeout 路径)
async function mockExecute(req: ExecuteRequest, timeoutMs: number): Promise<{
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}> {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let timedOut = false;

  // 简易 echo 提取 (PoC 仅做这个 — 真实执行器再说)
  const echoMatch = req.code.match(/^(?:echo|console\.log|print)\s*\(?['"]([^'"]*)['"]\)?/m);
  if (echoMatch) {
    stdout = echoMatch[1];
  } else {
    stdout = `[poc] executed ${req.language} code (${req.code.length} bytes)`;
  }

  // PoC 行为:
  //   - timeout_ms >= 1000: 50ms 模拟 IO, 返回 200
  //   - timeout_ms < 1000: 等满 timeoutMs (模拟长任务触发 timeout)
  const sleepMs = timeoutMs >= 1000 ? 50 : timeoutMs + 10;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    stderr = `timeout after ${timeoutMs}ms`;
    exitCode = 124; // standard timeout exit code
  }, timeoutMs);

  try {
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      if (controller.signal.aborted) done();
      else setTimeout(done, sleepMs);
    });
  } finally {
    clearTimeout(timer);
  }

  // 截断输出
  if (stdout.length > MAX_OUTPUT_BYTES) stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n[truncated]';
  if (stderr.length > MAX_OUTPUT_BYTES) stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n[truncated]';

  return { stdout, stderr, exit_code: exitCode, timed_out: timedOut };
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed", message: "POST only" }, 405);
  }

  try {
    const auth = await verifyAuth(req);
    // 仅 admin / owner 可调 (沙箱是高危面, 默认拒绝普通成员)
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({
        error: 'forbidden',
        message: `mp-sandbox requires admin role, got ${auth.role}`,
      }, 403);
    }

    let body: ExecuteRequest;
    try {
      body = await req.json() as ExecuteRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.code || typeof body.code !== 'string') {
      return jsonResponse({ error: 'invalid_code', message: 'code (string) is required' }, 400);
    }
    if (!body.language || !SUPPORTED_LANGUAGES.has(body.language)) {
      return jsonResponse({
        error: 'invalid_language',
        message: `language must be one of: ${[...SUPPORTED_LANGUAGES].join(', ')}`,
      }, 400);
    }
    if (body.code.length > MAX_CODE_BYTES) {
      return jsonResponse({
        error: 'code_too_large',
        message: `code exceeds ${MAX_CODE_BYTES} bytes`,
      }, 413);
    }

    const timeoutMs = body.timeout_ms ?? 5000;
    if (timeoutMs > MAX_TIMEOUT_MS) {
      return jsonResponse({
        error: 'timeout_too_large',
        message: `timeout_ms must be <= ${MAX_TIMEOUT_MS} (PoC limit; production: 30000-3600000)`,
      }, 400);
    }

    // 1. 黑白名单过滤
    const denied = denyReason(body.code);
    if (denied) {
      // 双写: mp_sandbox.executions + public.record_execution RPC → audit_log
      const codeSha = await sha256Hex(body.code);
      await recordExecution({
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'SANDBOX_DENIED',
        language: body.language,
        codeSha,
        codeBytes: body.code.length,
        timeoutMs,
        network: body.network ?? 'isolated',
        exitCode: null,
        durationMs: null,
        stdoutBytes: 0,
        stderrBytes: 0,
        mode: 'poc_mock',
        metadata: { reason: denied.reason, pattern_matched: denied.pattern_matched },
      });
      return jsonResponse({
        error: 'command_denied',
        message: denied.reason,
        pattern_matched: denied.pattern_matched,
      }, 403);
    }

    // 2. 执行 (PoC: mock)
    const startedAt = Date.now();
    const result = await mockExecute(body, timeoutMs);
    const durationMs = Date.now() - startedAt;

    const payload: ExecuteSuccess = {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: durationMs,
      language: body.language,
      mode: 'poc_mock',
      warning: 'PoC stub: no real sandbox. Production requires bwrap/Landlock sidecar. See ADR-0069.',
    };

    // 3. 双写 audit_log (成功 / timeout) — Issue #15 Loop 1: 加 mp_sandbox.executions 表写入
    const codeSha = await sha256Hex(body.code);
    await recordExecution({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: result.timed_out ? 'SANDBOX_TIMEOUT' : 'SANDBOX_EXECUTE',
      language: body.language,
      codeSha,
      codeBytes: body.code.length,
      timeoutMs,
      network: body.network ?? 'isolated',
      exitCode: result.exit_code,
      durationMs,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
      mode: 'poc_mock',
    });

    if (result.timed_out) {
      return jsonResponse({
        ...payload,
        ok: false,
        error: 'timeout',
        message: `execution exceeded ${timeoutMs}ms`,
      }, 408);
    }

    return jsonResponse(payload, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});