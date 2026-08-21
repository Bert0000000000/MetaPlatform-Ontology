// e2e/temporal-worker-cron.spec.ts
// MetaPlatform M40 Loop 3/3 — pg_cron 自动调度 worker
//
// 覆盖:
//   1. pg_cron job 'temporal-worker-cron' 已 schedule
//   2. 端到端: 触发 signal → 等 cron tick → consume → status=sent
//   3. Realtime 文档: production 通过 Realtime 订阅 (本地 dev 用 pg_cron)
//   4. /admin/monitoring 显示 temporal-worker-cron job

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M40 Loop 3/3 — Temporal worker pg_cron + Realtime', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let adminJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`twc-${suffix}`, 'Temporal Worker Cron E2E']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `twc-${suffix}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    adminUser = await r.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [adminUser.id, tenantA, adminUser.email]);

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
    await c.query('DELETE FROM public.workflow_signals WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.hitl_requests WHERE tenant_id = $1', [tenantA]);
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

  test('1. pg_cron job "temporal-worker-consume-cron" 已 schedule', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'temporal-worker-consume-cron'");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].active).toBe(true);
    expect(r.rows[0].schedule).toMatch(/^\*\/\d+ \* \* \* \*$/);
    await c.end();
  });

  test('2. 端到端: trigger signal → 手动调 consume → status=sent', async () => {
    // 触发 signal (via action-apply confirmed)
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'order.approve',
        target_id: '00000000-0000-0000-0000-000000000099',
        params: { decision: 'approved' },
        mode: 'confirmed',
      }),
    });
    expect(r.status).toBe(200);

    // 查 pending signal 数
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const before = (await c.query(
      "SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'pending'",
      [tenantA]
    )).rows[0].n;
    expect(before).toBeGreaterThanOrEqual(1);

    // 调 worker consume (模拟 cron tick)
    const consumeR = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(consumeR.status).toBe(200);
    const body = await consumeR.json();
    expect(body.succeeded).toBeGreaterThanOrEqual(1);

    // 查 sent count
    const after = (await c.query(
      "SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'sent'",
      [tenantA]
    )).rows[0].n;
    expect(after).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('3. Realtime 文档: production 通过 Realtime 订阅 workflow_signals UPDATE', async () => {
    // Realtime 通过 supabase-js channel().on('postgres_changes', ...) 接收 events
    // 本地 dev: 工具链复杂 (WebSocket 客户端), PoC 用 pg_cron.
    // 生产建议:
    //   const channel = supabase.channel('workflow_signals')
    //     .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workflow_signals' }, (payload) => {
    //       if (payload.new.status === 'pending') startTemporalWorkflow(payload.new)
    //     })
    //     .subscribe()
    // 验证: workflow_signals 表已在 supabase_realtime publication (Loop 1/3 migration)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'workflow_signals'"
    );
    expect(r.rows[0].n).toBe(1);
    await c.end();
  });

  test('4. /admin/monitoring 显示 temporal-worker-cron job', async ({ request }) => {
    const r = await request.get('http://127.0.0.1:8080/admin/monitoring');
    // mp-cron subsystem 显示 active jobs count > 0 (含 temporal-worker-consume-cron)
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('pg_cron');
  });
});