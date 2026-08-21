// e2e/temporal-worker.spec.ts
// MetaPlatform M40 Workflow worker 消费 workflow_signals (ADR-0052)
//
// 覆盖:
//   1. consume pending signals (2 条) → sent=2, workflow_signals.status='sent'
//   2. consume 空队列 → consumed=0
//   3. max_batch 限制
//   4. unknown workflow type → status='failed' + error
//   5. signal 已被消费 (status=sent) → 不会再次消费
//   6. worker_id 自定义
//   7. anon → 401
//   8. member → 403
//   9. 端到端: action-apply confirmed → workflow_signals → consume → sent

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M40 Workflow worker consume workflow_signals', () => {
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
      [`wfworker-${suffix}`, 'Workflow Worker E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `wfworker-${tag}-${suffix}@x.com`,
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

  // 创建一条 pending signal (via action-apply confirmed 模式, hitl INSERT → trigger 创建)
  async function createPendingSignalViaActionApply(workflowSuffix: string): Promise<{ hitlId: string; signalId: string; workflowId: string }> {
    // create hitl with workflow_id
    const r1 = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: 'test',
        approver_ids: [adminUser.id],
        workflow_id: `OrderApproval:wf-${workflowSuffix}`,
      }),
    });
    const { hitl_request_id } = await r1.json();
    // 决定 (approved) → trigger 创建 workflow_signal
    await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision: 'approved' }),
    });
    // 查 signal
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT id, workflow_id FROM public.workflow_signals WHERE hitl_request_id = $1",
      [hitl_request_id]
    );
    await c.end();
    return { hitlId: hitl_request_id, signalId: r.rows[0].id, workflowId: r.rows[0].workflow_id };
  }

  async function consume(workerId: string = 'test-worker', maxBatch: number = 10, jwt: string | null = adminJwt): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { 'apikey': ANON_KEY, 'Content-Type': 'application/json' };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ worker_id: workerId, max_batch: maxBatch }),
    });
    return { status: r.status, body: await r.json() };
  }

  test('1. consume pending signals → sent=2 + status=sent + sent_at 非空', async () => {
    await createPendingSignalViaActionApply('a1');
    await createPendingSignalViaActionApply('a2');

    const { status, body } = await consume('worker-1', 10);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.worker_id).toBe('worker-1');
    expect(body.consumed).toBe(2);
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(0);
    expect((body.sent_ids as string[]).length).toBe(2);

    // 查 DB: 2 条 sent
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT status, sent_at FROM public.workflow_signals WHERE tenant_id = $1 ORDER BY created_at",
      [tenantA]
    );
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].status).toBe('sent');
    expect(r.rows[0].sent_at).not.toBeNull();
    expect(r.rows[1].status).toBe('sent');
    await c.end();
  });

  test('2. consume 空队列 → consumed=0', async () => {
    const { status, body } = await consume('worker-2');
    expect(status).toBe(200);
    expect(body.consumed).toBe(0);
    expect(body.sent).toBe(0);
  });

  test('3. max_batch=1 限制 → 只 consume 1 条 (留 1 pending)', async () => {
    await createPendingSignalViaActionApply('b1');
    await createPendingSignalViaActionApply('b2');

    const { status, body } = await consume('worker-3', 1);
    expect(status).toBe(200);
    expect(body.consumed).toBe(1);
    expect(body.sent).toBe(1);

    // 第二条仍在 pending
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'pending'", [tenantA]);
    expect(r.rows[0].n).toBe(1);
    await c.end();
  });

  test('4. unknown workflow type → status=failed + error', async () => {
    // 直接 INSERT 一个 unknown workflow 的 signal (用新建的独立 hitl 避免 UNIQUE conflict)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const newHitl = (await c.query(
      "INSERT INTO public.hitl_requests (tenant_id, type, status, title, requester_id, approver_ids, workflow_id) VALUES ($1, 'workflow_saas', 'approved', 'unknown-wf-test', $2, ARRAY[$2], 'UnknownWorkflow:test') RETURNING id",
      [tenantA, adminUser.id]
    )).rows[0].id;
    await c.query(
      "INSERT INTO public.workflow_signals (tenant_id, hitl_request_id, workflow_id, signal_name, payload) VALUES ($1, $2, 'UnknownWorkflow:test', 'hitl_decision', '{}'::jsonb)",
      [tenantA, newHitl]
    );
    await c.end();

    const { status, body } = await consume('worker-4', 100);
    expect(status).toBe(200);
    expect(body.failed).toBeGreaterThanOrEqual(1);
    const failedDetails = body.failed_details as Array<{ id: string; error: string }>;
    const unknown = failedDetails.find((f) => f.error.includes('unknown workflow'));
    expect(unknown).toBeTruthy();

    // 查 DB: 状态 failed
    const c2 = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c2.connect();
    const r = await c2.query(
      "SELECT status, error FROM public.workflow_signals WHERE workflow_id = 'UnknownWorkflow:test'"
    );
    expect(r.rows[0].status).toBe('failed');
    expect(r.rows[0].error).toContain('unknown');
    await c2.end();
  });

  test('5. signal 已被消费 (status=sent) → 不会再次 consume', async () => {
    const sig = await createPendingSignalViaActionApply('c1');
    const { body: b1 } = await consume('worker-5', 10);
    expect(b1.sent).toBe(1);

    // 第二次 consume → 应该 0
    const { body: b2 } = await consume('worker-5', 10);
    expect(b2.consumed).toBe(0);
    expect(b2.sent).toBe(0);
  });

  test('6. worker_id 自定义 → 返回 worker_id 字段', async () => {
    const { body } = await consume('my-custom-worker-007');
    expect(body.worker_id).toBe('my-custom-worker-007');
  });

  test('7. anon → 401', async () => {
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  });

  test('8. member role → 403', async () => {
    const r = await fetch(`${API}/functions/v1/temporal-worker-consume`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(403);
  });

  test('9. 端到端: action-apply confirmed → trigger → worker consume → sent', async () => {
    // action-apply confirmed 模式创建 hitl approved + workflow_id → trigger INSERT workflow_signal
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
    const { workflow_id } = await r.json();

    // worker consume
    const { body } = await consume('e2e-worker', 10);
    expect(body.sent).toBeGreaterThanOrEqual(1);

    // 该 signal 应 sent
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query(
      "SELECT status FROM public.workflow_signals WHERE workflow_id = $1",
      [workflow_id]
    );
    expect(r2.rows[0].status).toBe('sent');
    await c.end();
  });
});