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

    // audit_log 应写一条 SANDBOX_EXECUTE
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND action = 'SANDBOX_EXECUTE' AND schema_name = 'mp_sandbox'",
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

    // audit_log 应写一条 SANDBOX_DENIED
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND action = 'SANDBOX_DENIED' AND schema_name = 'mp_sandbox'",
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

    // audit_log 应写一条 SANDBOX_TIMEOUT
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND action = 'SANDBOX_TIMEOUT' AND schema_name = 'mp_sandbox'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('4. anon POST (no Authorization header) -> 401', async () => {
    const r = await fetch(`${API}/functions/v1/mp-sandbox`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: "echo 'no auth'", language: 'bash' }),
    });
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error).toBeTruthy();
  });
});