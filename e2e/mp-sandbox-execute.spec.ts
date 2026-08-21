// e2e/mp-sandbox-execute.spec.ts
// MetaPlatform Issue #15 Loop 3/3 — mp-sandbox sidecar HTTP (真子进程)
//
// 覆盖:
//   1. 真子进程: bash 'echo hello' → 200 + stdout=hello + exit_code=0
//   2. 真子进程: python 'print(2+2)' → 200 + stdout=4
//   3. 真子进程: javascript 'console.log("hi")' → 200 + stdout=hi
//   4. 真子进程: rm -rf / → 403 command_denied (黑名单)
//   5. 真子进程: timeout (sleep 10, timeout_ms=500) → 408 timeout
//   6. 真子进程: mkfs → 403
//   7. 真子进程: exit_code != 0 (bash 'exit 7') → 500
//   8. 真子进程: SANDBOX_TIMEOUT 落 mp_sandbox.executions (duration_ms 非空)
//   9. 真子进程: SANDBOX_DENIED 落 mp_sandbox.executions (exit_code null)
//  10. anon POST → 401
//  11. member role → 403
//  12. invalid language → 400
//  13. invalid code (空) → 400

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('Issue #15 Loop 3/3 — mp-sandbox sidecar HTTP (真子进程)', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let adminJwt: string;
  let memberJwt: string;

  test.beforeAll(async () => {
    // 启动 mock sidecar (本地 dev: scripts/dev/mp-sandbox-sidecar.mjs 跑在 9999)
    try {
      const resp = await fetch('http://127.0.0.1:9999/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'echo probe', language: 'bash', timeout_ms: 1000 }),
      });
      if (!resp.ok) throw new Error('sidecar not 2xx');
    } catch (e) {
      throw new Error(`mp-sandbox sidecar not reachable at 9999: ${(e as Error).message}. Run: node scripts/dev/mp-sandbox-sidecar.mjs`);
    }

    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`sbx-${suffix}`, 'Sandbox Sidecar E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `sbx-${tag}-${suffix}@x.com`,
          password: 'Test123!',
          email_confirm: true,
          app_metadata: { tenant_id: tenantA, role },
        }),
      });
      const u = await r.json();
      await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)", [u.id, tenantA, u.email, role]);
      return u;
    };
    adminUser = await mkUser('admin', 'adm');
    memberUser = await mkUser('member', 'mem');

    const login = async (email: string) => {
      const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Test123!' }),
      });
      return (await r.json()).access_token;
    };
    adminJwt = await login(adminUser.email);
    memberJwt = await login(memberUser.email);
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query("DELETE FROM mp_sandbox.executions WHERE tenant_id = $1", [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id IN ($1, $2)', [adminUser.id, memberUser.id]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.end();
    for (const u of [adminUser.id, memberUser.id]) {
      try {
        await fetch(`${API}/auth/v1/admin/users/${u}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
        });
      } catch { /* noop */ }
    }
  });

  async function exec(code: string, language: 'bash'|'python'|'javascript', opts: Record<string, unknown> = {}, jwt: string = adminJwt): Promise<{ status: number; body: Record<string, unknown> }> {
    const r = await fetch(`${API}/functions/v1/mp-sandbox-execute`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, ...opts }),
    });
    return { status: r.status, body: await r.json() };
  }

  test('1. bash echo hello → 200 + stdout=hello', async () => {
    const { status, body } = await exec("echo 'hello'", 'bash');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stdout).toContain('hello');
    expect(body.exit_code).toBe(0);
  });

  test('2. python print(2+2) → 200 + stdout=4', async () => {
    const { status, body } = await exec('print(2+2)', 'python');
    expect(status).toBe(200);
    expect(body.stdout).toContain('4');
  });

  test('3. javascript console.log → 200 + stdout=hi', async () => {
    const { status, body } = await exec('console.log("hi"); process.exit(0)', 'javascript');
    expect(status).toBe(200);
    expect(body.stdout).toContain('hi');
  });

  test('4. rm -rf / → 403 command_denied', async () => {
    const { status, body } = await exec('rm -rf /', 'bash');
    expect(status).toBe(403);
    expect(body.error).toBe('command_denied');
  });

  test('5. timeout (sleep 10, timeout_ms=500) → 408', async () => {
    const { status, body } = await exec('sleep 10', 'bash', { timeout_ms: 500 });
    expect(status).toBe(408);
    expect(body.error).toBe('timeout');
    expect(body.timed_out).toBe(true);
  });

  test('6. mkfs → 403', async () => {
    const { status, body } = await exec('mkfs.ext4 /dev/sda1', 'bash');
    expect(status).toBe(403);
  });

  test('7. exit_code != 0 (bash exit 7) → 500', async () => {
    const { status, body } = await exec('exit 7', 'bash');
    expect(status).toBe(500);
    expect(body.exit_code).toBe(7);
  });

  test('8. SANDBOX_TIMEOUT 落 executions 表 (duration_ms 非空, mode=sidecar_sync)', async () => {
    await exec('sleep 5', 'bash', { timeout_ms: 300 });
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT action, duration_ms, mode FROM mp_sandbox.executions WHERE tenant_id = $1 AND action = 'SANDBOX_TIMEOUT' ORDER BY created_at DESC LIMIT 1",
      [tenantA]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].mode).toBe('sidecar_sync');
    expect(r.rows[0].duration_ms).toBeGreaterThan(0);
    await c.end();
  });

  test('9. SANDBOX_DENIED 落 executions 表 (exit_code null)', async () => {
    await exec('rm -rf /etc', 'bash');
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT action, exit_code, mode FROM mp_sandbox.executions WHERE tenant_id = $1 AND action = 'SANDBOX_DENIED' ORDER BY created_at DESC LIMIT 1",
      [tenantA]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].exit_code).toBeNull();
    expect(r.rows[0].mode).toBe('sidecar_sync');
    await c.end();
  });

  test('10. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/mp-sandbox-execute`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'echo hi', language: 'bash' }),
    });
    expect(r.status).toBe(401);
  });

  test('11. member role → 403', async () => {
    const { status, body } = await exec("echo 'hi'", 'bash', {}, memberJwt);
    expect(status).toBe(403);
    expect(body.error).toBe('forbidden');
  });

  test('12. invalid language → 400', async () => {
    const { status, body } = await exec("echo 'hi'", 'ruby' as 'bash');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_language');
  });

  test('13. invalid code (空) → 400', async () => {
    const { status, body } = await exec('', 'bash');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_code');
  });
});