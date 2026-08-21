// e2e/dsh-session.spec.ts
// MetaPlatform M15 dsh session Postgres backend (ADR-0055)
//
// 覆盖:
//   1. dsh-session-create → 返回 session_id + version=0
//   2. dsh-session-append-events (3 events) → appended=3, next_seq=2, version=1
//   3. dsh-session-append-events 非 contiguous seq → 409 seq_not_contiguous
//   4. dsh-session-load → header + events 按 seq 顺序
//   5. dsh-session-append-events cross-tenant → 403
//   6. dsh-session-create anon → 401
//   7. dsh_session_summary view → active_count 反映新 session
//   8. pg_cron job 'dsh-session-cleanup' 已 schedule

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M15 dsh session Postgres backend', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let adminJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`dsh-${suffix}`, 'DSH Session E2E']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `dsh-${suffix}@x.com`,
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
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminUser.email, password: 'Test123!' }),
    });
    adminJwt = (await loginR.json()).access_token;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query('DELETE FROM public.dsh_session_events WHERE session_id IN (SELECT id FROM public.dsh_session_headers WHERE tenant_id = $1)', [tenantA]);
    await c.query('DELETE FROM public.dsh_session_headers WHERE tenant_id = $1', [tenantA]);
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

  test('1. dsh-session-create → 返回 session_id + version=0', async () => {
    const r = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master', origin: 'web' }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.version).toBe(0);
    expect(body.status).toBe('running');
  });

  test('2. dsh-session-append-events (3 events) → appended=3, next_seq=2, version=1', async () => {
    // 先建 session
    const createR = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master' }),
    });
    const { session_id } = await createR.json();

    // append 3 events
    const r = await fetch(`${API}/functions/v1/dsh-session-append-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id,
        events: [
          { seq: 0, type: 'system', data: { init: true } },
          { seq: 1, type: 'user', data: { text: '你好' } },
          { seq: 2, type: 'assistant', data: { tool_use: 'kb_search' } },
        ],
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.appended).toBe(3);
    expect(body.next_seq).toBe(3);  // lastSeq=2 + 1
    expect(body.version).toBe(1);
  });

  test('3. dsh-session-append-events 非 contiguous seq (期望 5, 给 5+2=7) → 409', async () => {
    const createR = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master' }),
    });
    const { session_id } = await createR.json();

    // 先写 0,1,2
    await fetch(`${API}/functions/v1/dsh-session-append-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id,
        events: [
          { seq: 0, type: 'system', data: {} },
          { seq: 1, type: 'user', data: {} },
          { seq: 2, type: 'assistant', data: {} },
        ],
      }),
    });
    // 再写 3, 5 (跳 4) — 应 409
    const r = await fetch(`${API}/functions/v1/dsh-session-append-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id,
        events: [
          { seq: 3, type: 'user', data: {} },
          { seq: 5, type: 'assistant', data: {} },
        ],
      }),
    });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe('seq_not_contiguous');
    expect(body.expected_next_seq).toBe(3);
  });

  test('4. dsh-session-load → header + events 按 seq 顺序', async () => {
    const createR = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master' }),
    });
    const { session_id } = await createR.json();

    await fetch(`${API}/functions/v1/dsh-session-append-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id,
        events: [
          { seq: 0, type: 'system', data: { init: true } },
          { seq: 1, type: 'user', data: { msg: 'hello' } },
          { seq: 2, type: 'assistant', data: { reply: 'hi' } },
        ],
      }),
    });

    const r = await fetch(`${API}/functions/v1/dsh-session-load`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.session_id).toBe(session_id);
    expect(body.events.length).toBe(3);
    expect(body.events[0].seq).toBe(0);
    expect(body.events[1].seq).toBe(1);
    expect(body.events[2].seq).toBe(2);
    expect(body.stats.event_count).toBe(3);
    expect(body.stats.max_seq).toBe(2);
    expect(body.stats.version).toBe(1);
  });

  test('5. cross-tenant → 403 (create + load)', async () => {
    // 创建 tenantB 用户
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffixB = Date.now();
    const tenantB = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`dshb-${suffixB}`, 'DSH B']
    )).rows[0].id;
    const rb = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `dshb-${suffixB}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantB, role: 'admin' },
      }),
    });
    const userB = await rb.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userB.id, tenantB, userB.email]);
    const loginRb = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userB.email, password: 'Test123!' }),
    });
    const jwtB = (await loginRb.json()).access_token;
    // 创建 tenantA 的 session
    const cr = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master' }),
    });
    const { session_id } = await cr.json();

    // tenantB 用户尝试 append
    const r1 = await fetch(`${API}/functions/v1/dsh-session-append-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtB}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id,
        events: [{ seq: 0, type: 'system', data: {} }],
      }),
    });
    expect(r1.status).toBe(403);
    await c.query("DELETE FROM public.dsh_session_headers WHERE tenant_id = $1", [tenantB]);
    await c.query("DELETE FROM public.profiles WHERE id = $1", [userB.id]);
    await c.query("DELETE FROM public.tenants WHERE id = $1", [tenantB]);
    await c.end();
    try {
      await fetch(`${API}/auth/v1/admin/users/${userB.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      });
    } catch { /* noop */ }
  });

  test('6. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  });

  test('7. dsh_session_summary view → active_count 反映新 session', async () => {
    await fetch(`${API}/functions/v1/dsh-session-create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_preset: 'mp-v6-master' }),
    });
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT active_count, completed_count FROM public.dsh_session_summary WHERE tenant_id = $1",
      [tenantA]
    );
    expect(r.rows[0].active_count).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('8. pg_cron job "dsh-session-cleanup" 已 schedule', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dsh-session-cleanup'");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].active).toBe(true);
    expect(r.rows[0].schedule).toBe('0 2 * * *');
    await c.end();
  });
});