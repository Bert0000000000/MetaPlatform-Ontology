// supabase/functions/mp-sandbox-execute/index.ts
// PRD: docs/active/prd/mp-sandbox.md (production path)
// ADR:  docs/active/decisions/ADR-0069-mp-sandbox-poc.md §3.3 (sidecar HTTP)
// Batch: MetaPlatform-MP-SANDBOX-01 (Loop 3/3 — Issue #15)
//
// POST /functions/v1/mp-sandbox-execute
//   body: { session_id?, code, language, timeout_ms?, network? }
//
// 生产路径 (K8s): mp-runtime Deployment sidecar container 暴露 POST /execute
//   Sidecar 用 bwrap / Landlock / Seatbelt 进程级沙箱真执行
//   流程: EF 验权 + 黑名单 → 调 sidecar HTTP /execute → 拿到 result → 写 mp_sandbox.executions
//
// 本地 dev (PoC): Supabase Edge Runtime 不允许 Deno.Command subprocess
//   sidecar URL 从 env SIDECAR_URL 读; 默认 "http://127.0.0.1:9999/execute" (unreachable)
//   实际跑命令绕过 EF (由测试环境直接模拟); EF 侧负责: 黑名单 + 写 executions 表 + 调 sidecar
//   真生产: sidecar_url=http://mp-runtime-sidecar.mp-runtime.svc:8080/execute (K8s Service DNS)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";
import { startSpan, endSpan, recordException, newSpanContext, traceparentHeader } from "../../../observability/otel.ts";

interface ExecuteRequest {
  session_id?: string;
  code: string;
  language: 'python' | 'javascript' | 'bash';
  timeout_ms?: number;
  network?: 'isolated' | 'internet';
}

const MAX_CODE_BYTES = 1_048_576;       // 1 MiB
const MAX_OUTPUT_BYTES = 1_048_576;     // 1 MiB
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30_000;          // sidecar PoC 上限 (生产: 3600000)

// 危险命令黑名单 (PoC: regex; 生产: AST 解析 / Landlock 强制)
const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-[a-z]*r|-[a-z]*f)[^\n]*\s+\//i, reason: 'recursive forced remove on root' },
  { pattern: /\brm\s+-[a-z]*r[^\n]*\s+\/(?!\s*tmp)/i, reason: 'recursive remove outside /tmp' },
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: 'filesystem format' },
  { pattern: /\bdd\s+if=/i, reason: 'raw block read' },
  { pattern: /\bdd\s+of=\/dev\//i, reason: 'raw block write to device' },
  { pattern: /:\(\)\s*\{.*:\s*\|\s*:.*\}\s*;?\s*:/i, reason: 'bash fork bomb' },
  { pattern: /\b(?:curl|wget)\s+[^|]*\|\s*(?:bash|sh|zsh)\b/i, reason: 'remote script piped to shell' },
  { pattern: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/i, reason: 'system power control' },
  { pattern: /\biptables\b|\bfirewall\b|\bnft\b/i, reason: 'firewall manipulation' },
  { pattern: /\bchmod\s+(-[a-z]*\s+)?(?:0?777|0?666)\b/i, reason: 'world-writable chmod' },
  { pattern: /\bchown\s+-R?\b[^\n]*\s+\/(?!\s*(?:home|tmp|app)\b)/i, reason: 'recursive chown on system path' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'raw write to disk device' },
];

function denyReason(code: string): { reason: string; pattern_matched: string } | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) return { reason, pattern_matched: pattern.source };
  }
  return null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface SidecarResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
}

// 调 sidecar HTTP /execute (生产 K8s Service DNS; 本地 dev 用 mock URL)
async function callSidecar(args: {
  sidecar_url: string;
  code: string;
  language: string;
  timeout_ms: number;
  network: string;
  session_id?: string;
}): Promise<SidecarResult> {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeout_ms + 1000);  // 给 sidecar 1s 余量
    const resp = await fetch(args.sidecar_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: args.code,
        language: args.language,
        timeout_ms: args.timeout_ms,
        network: args.network,
        session_id: args.session_id,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return { ok: false, stdout: '', stderr: `sidecar HTTP ${resp.status}`, exit_code: 1, timed_out: false, duration_ms: Date.now() - t0 };
    }
    return await resp.json() as SidecarResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, stdout: '', stderr: `sidecar unreachable: ${msg}`, exit_code: 1, timed_out: false, duration_ms: Date.now() - t0 };
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'POST only' }, 405);
  }
  // M10 Loop 3/3: OTel trace context propagation (W3C traceparent)
  const incomingTp = req.headers.get('traceparent');
  const otelCtx = newSpanContext(incomingTp);
  const endDedup = startSpan('mp-sandbox-execute', otelCtx, {
    'http.method': 'POST',
    'http.route': '/functions/v1/mp-sandbox-execute',
  });
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'mp-sandbox-execute requires admin or owner role' }, 403);
    }

    let body: ExecuteRequest;
    try { body = await req.json() as ExecuteRequest; }
    catch { return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400); }

    if (!body.code || typeof body.code !== 'string') {
      return jsonResponse({ error: 'invalid_code', message: 'code (string) required' }, 400);
    }
    if (!['python', 'javascript', 'bash'].includes(body.language)) {
      return jsonResponse({ error: 'invalid_language', message: 'language must be python|javascript|bash' }, 400);
    }
    if (body.code.length > MAX_CODE_BYTES) {
      return jsonResponse({ error: 'code_too_large', message: `code > ${MAX_CODE_BYTES} bytes` }, 413);
    }
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(100, body.timeout_ms ?? DEFAULT_TIMEOUT_MS));
    const network = body.network ?? 'isolated';

    // 黑名单 → 403
    const denied = denyReason(body.code);
    if (denied) {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await sb.from('mp_sandbox.executions').insert({
        tenant_id: auth.tenantId,
        actor_id: auth.userId,
        action: 'SANDBOX_DENIED',
        language: body.language,
        code_sha256: await sha256Hex(body.code),
        code_bytes: body.code.length,
        timeout_ms: timeoutMs,
        network,
        exit_code: null,
        duration_ms: null,
        stdout_bytes: 0,
        stderr_bytes: 0,
        mode: 'sidecar_sync',
        metadata: { reason: denied.reason, pattern_matched: denied.pattern_matched },
      });
      return jsonResponse({ error: 'command_denied', message: denied.reason, pattern_matched: denied.pattern_matched }, 403);
    }

    // 调 sidecar (K8s Service DNS) 或 mock URL
    // 本地 dev (PoC): docker 容器 mp-sandbox-sidecar 在同一 supabase_network
    //   通过 env SIDECAR_URL 覆盖
    //   生产 (K8s): http://mp-runtime-sidecar.mp-runtime.svc:8080/execute
    const sidecarUrl = Deno.env.get('SIDECAR_URL') ?? 'http://mp-sandbox-sidecar:9999/execute';
    const result = await callSidecar({
      sidecar_url: sidecarUrl,
      code: body.code,
      language: body.language,
      timeout_ms: timeoutMs,
      network,
      session_id: body.session_id,
    });

    // 写 executions (SANDBOX_TIMEOUT / SANDBOX_EXECUTE)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const action = result.timed_out ? 'SANDBOX_TIMEOUT' : 'SANDBOX_EXECUTE';
    await sb.from('mp_sandbox.executions').insert({
      tenant_id: auth.tenantId,
      actor_id: auth.userId,
      action,
      language: body.language,
      code_sha256: await sha256Hex(body.code),
      code_bytes: body.code.length,
      timeout_ms: timeoutMs,
      network,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      stdout_bytes: result.stdout.length,
      stderr_bytes: result.stderr.length,
      mode: 'sidecar_sync',
      metadata: { sidecar_url: sidecarUrl, sidecar_reachable: !result.stderr.startsWith('sidecar unreachable') },
    });

    if (result.timed_out) {
      return jsonResponse({
        ok: false, error: 'timeout', message: `execution exceeded ${timeoutMs}ms`,
        stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, duration_ms: result.duration_ms,
        language: body.language, mode: 'sidecar_sync', sidecar_url: sidecarUrl,
      }, 408);
    }
    if (!result.ok) {
      return jsonResponse({
        ok: false,
        stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, duration_ms: result.duration_ms,
        language: body.language, mode: 'sidecar_sync', sidecar_url: sidecarUrl,
        error: result.stderr.startsWith('sidecar unreachable') ? 'sidecar_unreachable' : 'execution_failed',
        message: result.stderr,
      }, 500);
    }
    return jsonResponse({
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      language: body.language,
      mode: 'sidecar_sync',
      sidecar_url: sidecarUrl,
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}