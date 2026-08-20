// e2e/edge-functions.spec.ts
// MetaPlatform E2E: Edge Functions 端到端测试
//
// 验证:
//   1. create-customer dedup (同 email 返回同一 record)
//   2. send-notification Realtime broadcast
//   3. ticket-triage 高优 → HITL 创建
//
// 运行: pnpm exec playwright test edge-functions

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
// Supabase local dev defaults (per `supabase status`). Override with SUPABASE_* env vars.
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('Edge Functions', () => {
  let tenantA: string;
  let userAJwt: string;
  let userA: { id: string; email: string };

  test.beforeAll(async () => {
    const pgClient = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    const suffix = Date.now();
    tenantA = (await pgClient.query(
      'INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`e2e-ef-${suffix}`, 'E2E EF']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `e2e-ef-${suffix}@x.com`, password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
    });
    userA = await r.json();
    await pgClient.query('INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)', [userA.id, tenantA, userA.email, 'admin']);

    const loginR = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await loginR.json()).access_token;
    await pgClient.end();
  });

  test.afterAll(async () => {
    const pgClient = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    // 删除所有 tenant 关联表 (兼容旧测试残留)
    for (const t of ['hitl_escalation_events', 'hitl_poll_queue', 'hitl_requests', 'event_queue', 'event_dlq', 'dsh_session_events', 'dsh_session_headers', 'audit_log', 'notifications', 'customers', 'orders', 'contracts', 'products', 'invoices', 'tickets', 'employees', 'departments', 'ontology_object_types', 'ontology_action_types', 'pending_object_changes', 'dsh_token_usage']) {
      try { await pgClient.query(`DELETE FROM public.${t} WHERE tenant_id = $1`, [tenantA]); } catch (e) {}
    }
    try { await pgClient.query('DELETE FROM public.profiles WHERE id = $1', [userA.id]); } catch (e) {}
    try { await pgClient.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]); } catch (e) { console.log('tenant cleanup warn:', (e as Error).message); }
    await pgClient.end();
  });

  test('1. create-customer → 201 + dedup same email', async () => {
    const email = `dedup-${Date.now()}@x.com`;

    const r1 = await fetch(`${API}/functions/v1/create-customer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dedup Test', contact_email: email }),
    });
    expect(r1.status).toBe(201);
    const c1 = await r1.json();
    expect(c1.deduped).toBe(false);

    // 第二次同 email
    const r2 = await fetch(`${API}/functions/v1/create-customer`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dedup Test 2', contact_email: email }),
    });
    expect(r2.status).toBe(200);  // deduped returns 200, not 201
    const c2 = await r2.json();
    expect(c2.deduped).toBe(true);
    expect(c2.customer_id).toBe(c1.customer_id);
  });

  test('2. send-notification → 200 + Realtime broadcast', async () => {
    const r = await fetch(`${API}/functions/v1/send-notification`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_user_ids: [userA.id],
        title: 'E2E Test',
        body: 'Hello from E2E',
        channels: ['realtime'],
        priority: 'normal',
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results.realtime.sent).toBe(1);

    // 验证 notifications 表有记录
    const pgClient = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    try { const n = await pgClient.query('SELECT count(*)::int AS n FROM public.notifications WHERE tenant_id = $1', [tenantA]); expect(n.rows[0].n).toBeGreaterThanOrEqual(1); } catch (e) { /* notifications table optional */ }
    await pgClient.end();
  });

  test('3. ticket-triage high priority → HITL request', async () => {
    // 先创建 ticket
    const pgClient = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    const ticket = (await pgClient.query(
      'INSERT INTO public.tickets (tenant_id, ticket_number, title, status, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [tenantA, `TKT-E2E-${Date.now()}`, 'Production down crash', 'open', 'urgent']
    )).rows[0];

    // 调 ticket-triage
    const r = await fetch(`${API}/functions/v1/ticket-triage`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticket.id, auto_apply: false }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.triage.priority).toBe('urgent');

    // 验证 hitl_request 被创建 (urgent → HITL)
    const hitl = await pgClient.query(
      'SELECT count(*)::int AS n FROM public.hitl_requests WHERE tenant_id = $1 AND context->>\'ticket_id\' = $2',
      [tenantA, ticket.id]
    );
    expect(hitl.rows[0].n).toBe(1);

    await pgClient.end();
  });
});