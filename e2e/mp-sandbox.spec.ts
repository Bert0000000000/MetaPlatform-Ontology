// e2e/mp-sandbox.spec.ts
// MetaPlatform.1 mp-sandbox Edge Function PoC (Issue #16 tracker, ADR-0069)
//
// 验证 (4 个用例):
//   1. admin POST execute ('echo hello') -> 200 + 模拟 stdout
//   2. denied dangerous command ('rm -rf /') -> 403 + audit_log 写入 SANDBOX_DENIED
//   3. timeout exceeded (timeout_ms=5000 但请求 sleep) -> 408 + audit_log 写入 SANDBOX_TIMEOUT
//   4. anon POST -> 401 (no auth header)
//
// 运行: pnpm exec playwright test mp-sandbox

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('mp-sandbox Edge Function PoC', () => {
  let tenantA: string;
  let adminJwt: string;
  let adminUser: { id: string; email: string };

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`sandbox-${suffix}`, 'Sandbox PoC Test']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `sandbox-admin-${suffix}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    adminUser = await r.json();
    await c.query(
      "INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [adminUser.id, tenantA, adminUser.email]
    );

    const loginR = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminUser.email, password: 'Test123!' }),
    });
    adminJwt = (await loginR.json()).access_token;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // cleanup audit_log entries created by this tenant
    try { await c.query("DELETE FROM public.audit_log WHERE tenant_id = $1 AND schema_name = 'mp_sandbox'", [tenantA]); } catch (e) { console.log('audit_log cleanup warn:', (e as Error).message); }
    try { await c.query("DELETE FROM mp_sandbox.executions WHERE tenant_id = $1", [tenantA]); } catch (e) { console.log('executions cleanup warn:', (e as Error).message); }
    try { await c.query('DELETE FROM public.profiles WHERE id = $1', [adminUser.id]); } catch (e) {}
    try { await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]); } catch (e) {}
    await c.end();
    try {
      await fetch(`${API}/auth/v1/admin/users/${adminUser.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      });
    } catch (e) {}
  });

  test('1. admin POST execute (echo hello) -> 200 + poc_mock', async () => {
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: "echo 'hello'", language: 'bash' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.stdout).toContain('hello');
    expect(body.mode).toBe('poc_mock');
    expect(body.warning).toBeTruthy();
    expect(typeof body.exit_code).toBe('number');
    expect(typeof body.duration_ms).toBe('number');

    // Loop 2/3: audit_log 由 tg_mp_sandbox_executions_audit 触发器自动写入
    // (action='INSERT', new_values.action='SANDBOX_EXECUTE' 保留 semantic 信息)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND schema_name = 'mp_sandbox' AND action = 'INSERT' AND new_values->>'action' = 'SANDBOX_EXECUTE'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('2. denied dangerous command (rm -rf /) -> 403', async () => {
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'rm -rf /', language: 'bash' }),
    });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('command_denied');
    expect(body.pattern_matched).toBeTruthy();
    expect(body.message).toBeTruthy();

    // Loop 2/3: audit_log 由 trigger 写入 (new_values.action='SANDBOX_DENIED')
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND schema_name = 'mp_sandbox' AND action = 'INSERT' AND new_values->>'action' = 'SANDBOX_DENIED'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('3. timeout exceeded -> 408', async () => {
    // PoC 模拟器: timeout_ms < 1000 触发 mockExecute 的 AbortController 路径, 返回 408 + SANDBOX_TIMEOUT
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sleep 9999', language: 'bash', timeout_ms: 500 }),
    });
    expect(r.status).toBe(408);
    const body = await r.json();
    expect(body.error).toBe('timeout');
    expect(body.message).toContain('500ms');

    // Loop 2/3: audit_log 由 trigger 写入 (new_values.action='SANDBOX_TIMEOUT')
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND schema_name = 'mp_sandbox' AND action = 'INSERT' AND new_values->>'action' = 'SANDBOX_TIMEOUT'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('4. anon POST (no Authorization header) -> 401', async () => {
    // Supabase gateway 在 apikey 不可解析为有效 user JWT 时直接 401
    // (response shape: { code: 'UNAUTHORIZED_LEGACY_JWT', ... } 或 EF 的 MISSING_AUTH).
    // 验收: status === 401 (anon 必须被拒).
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: "echo 'no auth'", language: 'bash' }),
    });
    expect(r.status).toBe(401);
  });

  // Issue #15 Loop 1/3: mp_sandbox.executions 表 + execution_stats view
  // (RLS 隔离由 _policy_tenant_select + mp-runtime test 4 cross-tenant RLS 已覆盖)
  test('5. mp_sandbox.executions table + execution_stats view', async () => {
    // 先做一次 execute 触发 EF 写表
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: "echo 'executions-table-test'", language: 'bash' }),
    });
    if (r.status !== 200) {
      const txt = await r.text();
      throw new Error(`EF POST failed: ${r.status} ${txt}`);
    }

    // 用 service_role 直接查 mp_sandbox.executions (应该至少有 1 行本次 + 之前)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const all = await c.query(
      "SELECT action, language, code_bytes, network, mode FROM mp_sandbox.executions WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantA],
    );
    expect(all.rows.length).toBeGreaterThanOrEqual(1);
    const row = all.rows[0];
    expect(row.action).toBe('SANDBOX_EXECUTE');
    expect(row.language).toBe('bash');
    expect(row.network).toBe('isolated');
    expect(row.mode).toBe('poc_mock');

    // execution_stats view 也能查 (count 返回 bigint → cast int)
    const stats = await c.query(
      "SELECT execute_count::int AS execute_count, denied_count::int AS denied_count, timeout_count::int AS timeout_count FROM mp_sandbox.execution_stats WHERE tenant_id = $1 ORDER BY hour DESC LIMIT 1",
      [tenantA],
    );
    expect(stats.rows.length).toBeGreaterThanOrEqual(1);
    expect(stats.rows[0].execute_count).toBeGreaterThanOrEqual(1);

    // 验证 _policy_tenant_* 4 个 RLS policy 都已经挂到表上
    const policies = await c.query(
      "SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'mp_sandbox.executions'::regclass ORDER BY polcmd"
    );
    expect(policies.rows.length).toBe(4);  // SELECT/INSERT/UPDATE/DELETE
    const cmds = policies.rows.map((r) => r.polcmd).sort();
    expect(cmds).toEqual(['a', 'd', 'r', 'w']);

    // tg_inject_tenant + tg_audit 触发器都已挂
    const triggers = await c.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'mp_sandbox.executions'::regclass AND NOT tgisinternal"
    );
    const tgnames = triggers.rows.map((r) => r.tgname);
    expect(tgnames).toContain('tg_mp_sandbox_executions_inject_tenant');
    expect(tgnames).toContain('tg_mp_sandbox_executions_audit');

    await c.end();
  });
});