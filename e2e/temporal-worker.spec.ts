// e2e/temporal-worker.spec.ts
// MetaPlatform M40 Loop 2/3 — Temporal worker mock 消费 workflow_signals
//
// 覆盖:
//   1. GET /temporal-worker-consume → 200 + consumed=N
//   2. consume 前 pending count > 0, 后 = 0
//   3. consume 后 sent count 增加
//   4. workflow_signals 触发后 + Temporal 启动 → status=sent
//   5. invalid decision payload → status=failed + error
//   6. 多次 consume (重复) → 0 consumed (no pending)
//   7. anon → 401
//   8. member → 403
//   9. limit 参数工作 (limit=1 只 consume 1 个)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M40 Temporal worker consume workflow_signals', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let adminJwt: string;
  let memberJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`tw-${suffix}`, 'Temporal Worker E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `tw-${tag}-${suffix}@x.com`,
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
    await c.query('DELETE FROM public.workflow_signals WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.hitl_requests WHERE tenant_id = $1', [tenantA]);
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

  // Helper: 创建 HITL + decide approved (带 workflow_id → 触发 signal)
  async function createPendingSignal(workflowId: string, decision: 'approved' | 'rejected' = 'approved'): Promise<string> {
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: 'test',
        approver_ids: [adminUser.id],
        workflow_id: workflowId,
      }),
    });
    const { hitl_request_id } = await createR.json();
    const decideR = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision, note: 'tw' }),
    });
    if (!decideR.ok) throw new Error('decide failed');
    return hitl_request_id;
  }

  async function getPendingCount(): Promise<number> {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'pending'",
      [tenantA]
    );
    await c.end();
    return r.rows[0].n;
  }

  test('1. GET /temporal-worker-consume → 200 + consumed field', async () => {
    await createPendingSignal('OrderApproval:tw-1');
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.consumed).toBeGreaterThanOrEqual(1);
    expect(body.succeeded).toBeGreaterThanOrEqual(1);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
  });

  test('2. consume 前 pending > 0, 后 = 0', async () => {
    await createPendingSignal('OrderApproval:tw-2');
    const before = await getPendingCount();
    expect(before).toBeGreaterThanOrEqual(1);
    await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const after = await getPendingCount();
    expect(after).toBe(0);
  });

  test('3. consume 后 sent count 增加 + sent_at 非空', async () => {
    await createPendingSignal('OrderApproval:tw-3');
    await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT status, sent_at FROM public.workflow_signals WHERE tenant_id = $1 AND workflow_id = 'OrderApproval:tw-3'",
      [tenantA]
    );
    expect(r.rows[0].status).toBe('sent');
    expect(r.rows[0].sent_at).not.toBeNull();
    await c.end();
  });

  test('4. workflow_signals result 包含 workflow_id + status=sent', async () => {
    await createPendingSignal('OrderApproval:tw-4');
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const result = body.results.find((x: { workflow_id: string }) => x.workflow_id === 'OrderApproval:tw-4');
    expect(result).toBeTruthy();
    expect(result.status).toBe('sent');
  });

  test('5. 多次 consume (重复) → 0 consumed (no pending)', async () => {
    await createPendingSignal('OrderApproval:tw-5a');
    await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    // 第二次 consume (无 pending)
    const r2 = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body2 = await r2.json();
    expect(body2.consumed).toBe(0);
    expect(body2.succeeded).toBe(0);
  });

  test('6. invalid decision payload → status=failed + error', async () => {
    // 直接 INSERT 一个 payload.decision 不合法的 signal
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const hitlR = await c.query(
      "INSERT INTO public.hitl_requests (tenant_id, type, status, title, requester_id, approver_ids, workflow_id) VALUES ($1, 'workflow_saas', 'pending', 'invalid', $2, ARRAY[$2], 'OrderApproval:invalid') RETURNING id",
      [tenantA, adminUser.id]
    );
    const hitlId = hitlR.rows[0].id;
    await c.query(
      "INSERT INTO public.workflow_signals (tenant_id, hitl_request_id, workflow_id, signal_name, payload, status) VALUES ($1, $2, 'OrderApproval:invalid', 'hitl_decision', $3::jsonb, 'pending')",
      [tenantA, hitlId, JSON.stringify({ decision: 'invalid_decision', no_decision: true })]
    );
    await c.end();

    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const failed = body.results.find((x: { workflow_id: string; status: string }) => x.workflow_id === 'OrderApproval:invalid' && x.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed.error).toContain('decision');

    // 查 DB: status=failed
    const c2 = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c2.connect();
    const r2 = await c2.query(
      "SELECT status, error FROM public.workflow_signals WHERE workflow_id = 'OrderApproval:invalid'"
    );
    expect(r2.rows[0].status).toBe('failed');
    await c2.end();
  });

  test('7. anon → 401', async () => {
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(401);
  });

  test('8. member role → 403', async () => {
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(403);
  });

  test('9. limit 参数工作 (limit=1 只 consume 1 个)', async () => {
    await createPendingSignal('OrderApproval:limit-1');
    await createPendingSignal('OrderApproval:limit-2');
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume?limit=1`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    expect(body.consumed).toBeLessThanOrEqual(1);
  });
});