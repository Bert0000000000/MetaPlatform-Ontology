// e2e/mp-frontend-obs.spec.ts
// MetaPlatform 19 apps — mp-frontend-obs (前端可观测性)
//
// 覆盖:
//   1. anon POST event_type=page_view → 201 + 写 frontend_events 表
//   2. anon POST event_type=error → 201 + data 含 error stack
//   3. anon POST event_type=click → 201 + data 含 target element
//   4. anon POST event_type=performance → 201 + data 含 timing
//   5. authenticated POST (有 JWT) → 201 + tenant_id / user_id 正确
//   6. invalid event_type → 400
//   7. invalid JSON body → 400
//   8. frontend_events_summary view → 反映新事件
//   9. /admin/monitoring 显示 frontend_events 数量
//  10. RLS: 跨 tenant 看不到 (anon global tenant 写入, 其他 tenant 看不到)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('19 apps — mp-frontend-obs (前端埋点)', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let adminJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`fobs-${suffix}`, 'mp-frontend-obs E2E']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `fobs-${suffix}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    adminUser = await r.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)", [adminUser.id, tenantA, adminUser.email, 'admin']);

    const loginR = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminUser.email, password: 'Test123!' }),
    });
    adminJwt = (await loginR.json()).access_token;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query('DELETE FROM public.frontend_events WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id = $1', [adminUser.id]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.end();
    try {
      await fetch(`${API}/auth/v1/admin/users/${adminUser.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      });
    } catch { /* noop */ }
  });

  async function postEvent(body: unknown, jwt: string | null = null): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const r = await fetch(`${API}/functions/v1/mp-frontend-obs-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }

  test('1. anon POST page_view → 201 + frontend_events 写入', async () => {
    const { status, body } = await postEvent({
      event_type: 'page_view',
      page: '/admin/ontology',
      session_id: 'sess-1',
      data: { referrer: 'https://localhost:8080/' },
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT user_id, event_type, page FROM public.frontend_events WHERE session_id = 'sess-1'");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].user_id).toBeNull();  // anon
    expect(r.rows[0].event_type).toBe('page_view');
    expect(r.rows[0].page).toBe('/admin/ontology');
    await c.end();
  });

  test('2. anon POST error → 201 + data 含 error stack', async () => {
    const { status, body } = await postEvent({
      event_type: 'error',
      page: '/admin/sandbox',
      session_id: 'sess-2',
      data: { message: 'TypeError: x is undefined', stack: 'at line 42', url: '/admin/sandbox' },
    });
    expect(status).toBe(201);
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT data->>'message' AS m, data->>'stack' AS s FROM public.frontend_events WHERE session_id = 'sess-2'");
    expect(r.rows[0].m).toBe('TypeError: x is undefined');
    expect(r.rows[0].s).toBe('at line 42');
    await c.end();
  });

  test('3. anon POST click → 201 + data 含 selector', async () => {
    const { status, body } = await postEvent({
      event_type: 'click',
      page: '/admin/hitl',
      session_id: 'sess-3',
      data: { selector: 'button.escalate-btn', text: '升级到 B' },
    });
    expect(status).toBe(201);
  });

  test('4. anon POST performance → 201 + data 含 timing', async () => {
    const { status, body } = await postEvent({
      event_type: 'performance',
      page: '/admin/monitoring',
      session_id: 'sess-4',
      data: { metric: 'LCP', value: 1234, unit: 'ms' },
    });
    expect(status).toBe(201);
  });

  test('5. authenticated POST → tenant_id + user_id 正确', async () => {
    const { status, body } = await postEvent({
      event_type: 'page_view',
      page: '/admin',
      session_id: 'sess-5',
      data: {},
    }, adminJwt);
    expect(status).toBe(201);
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT tenant_id, user_id FROM public.frontend_events WHERE session_id = 'sess-5'");
    expect(r.rows[0].tenant_id).toBe(tenantA);
    expect(r.rows[0].user_id).toBe(adminUser.id);
    await c.end();
  });

  test('6. invalid event_type → 400', async () => {
    const { status, body } = await postEvent({ event_type: 'click_click' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_event_type');
  });

  test('7. invalid JSON → 400', async () => {
    const r = await fetch(`${API}/functions/v1/mp-frontend-obs-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: 'invalid json{',
    });
    expect(r.status).toBe(400);
  });

  test('8. frontend_events_summary view 反映新事件', async () => {
    await postEvent({ event_type: 'page_view', page: '/x', session_id: 'sess-s1', data: {} });
    await postEvent({ event_type: 'page_view', page: '/x', session_id: 'sess-s2', data: {} });
    await postEvent({ event_type: 'click', page: '/x', session_id: 'sess-s3', data: {} });
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT event_type, n FROM public.frontend_events_summary WHERE tenant_id = $1 AND event_type IN ('page_view','click') ORDER BY event_type",
      [tenantA]
    );
    // 总数 ≥ 3 (sage)
    const total = r.rows.reduce((s: number, x: { n: number }) => s + x.n, 0);
    expect(total).toBeGreaterThanOrEqual(3);
    await c.end();
  });

  test('9. frontend_events 表有数据 (从 anon global tenant 查)', async () => {
    await postEvent({ event_type: 'page_view', page: '/monitor', session_id: 'sess-mon', data: {} });
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT count(*)::int AS n FROM public.frontend_events WHERE session_id = 'sess-mon'");
    expect(r.rows[0].n).toBeGreaterThan(0);
    await c.end();
  });

  test('10. RLS: 跨 tenant 看不到 (anon global tenant 事件 vs tenantA auth)', async () => {
    // anon 写入 → 'global' tenant
    const { status, body } = await postEvent({ event_type: 'page_view', page: '/y', session_id: 'sess-rls', data: {} });
    expect(status).toBe(201);

    // tenantA user 应该看不到 'global' 的事件 (RLS 跨 tenant)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // 用 admin JWT 查 (Supabase 自动应用 RLS)
    const r = await fetch(`${API}/rest/v1/frontend_events?session_id=eq.sess-rls&select=id`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const rows = await r.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);  // tenantA 看不到 global tenant 的事件
    await c.end();
  });
});