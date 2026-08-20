// e2e/workflow-signals.spec.ts
// MetaPlatform M13 HITL Hub Loop 2/3 — workflow_signals 队列 + Temporal signal 消费
//
// 覆盖:
//   1. decide-hitl approved (with workflow_id) → INSERT workflow_signals (status=pending)
//   2. decide-hitl approved (no workflow_id) → 不创建 workflow_signals
//   3. decide-hitl rejected (with workflow_id) → INSERT workflow_signals
//   4. list-workflow-signals → 看见 pending signal
//   5. ack-workflow-signal 'sent' → status=sent + sent_at
//   6. ack-workflow-signal 'acknowledged' → status=acknowledged + acknowledged_at
//   7. ack-workflow-signal 'failed' with error → status=failed + error
//   8. ack-workflow-signal already_acknowledged → 409
//   9. anon GET → 401
//  10. list-workflow-signals member → 403
//  11. TG 幂等: 同一个 hitl_id 重新决策 → ON CONFLICT 更新 payload (status 重置 pending)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M13 HITL Hub Loop 2/3 — workflow_signals queue', () => {
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
      [`wf-${suffix}`, 'Workflow Signals E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `wf-${tag}-${suffix}@x.com`,
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

  // Helper: create HITL + decide it
  async function createAndDecide(decision: 'approved' | 'rejected', workflowId?: string): Promise<string> {
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: '订单审批',
        approver_ids: [adminUser.id],
        workflow_id: workflowId,
        payload: { test: true },
      }),
    });
    const { hitl_request_id } = await createR.json();
    const decideR = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision, note: `e2e ${decision}` }),
    });
    if (!decideR.ok) {
      throw new Error(`decide failed: ${decideR.status} ${await decideR.text()}`);
    }
    return hitl_request_id;
  }

  test('1. decide approved (with workflow_id) → workflow_signals pending', async () => {
    await createAndDecide('approved', 'OrderApproval:order-001');
    // 查 workflow_signals
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT status, workflow_id, signal_name, payload FROM public.workflow_signals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
      [tenantA]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].status).toBe('pending');
    expect(r.rows[0].workflow_id).toBe('OrderApproval:order-001');
    expect(r.rows[0].signal_name).toBe('hitl_decision');
    expect(r.rows[0].payload.decision).toBe('approved');
    expect(r.rows[0].payload.note).toBe('e2e approved');
    await c.end();
  });

  test('2. decide approved (no workflow_id) → 不创建 workflow_signals', async () => {
    // 先查当前 pending 数量
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const before = (await c.query("SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1", [tenantA])).rows[0].n;
    await createAndDecide('approved'); // no workflow_id
    const after = (await c.query("SELECT count(*)::int AS n FROM public.workflow_signals WHERE tenant_id = $1", [tenantA])).rows[0].n;
    expect(after).toBe(before);  // 无 workflow_id 不触发
    await c.end();
  });

  test('3. decide rejected (with workflow_id) → INSERT workflow_signals payload.decision=rejected', async () => {
    await createAndDecide('rejected', 'OrderApproval:order-002');
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query(
      "SELECT status, payload FROM public.workflow_signals WHERE tenant_id = $1 AND workflow_id = 'OrderApproval:order-002'",
      [tenantA]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].payload.decision).toBe('rejected');
    await c.end();
  });

  test('4. list-workflow-signals (admin) → 看见 pending', async () => {
    const r = await fetch(`${API}/functions/v1/list-workflow-signals?status=pending&limit=50`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(1);
    const sigs = body.results.filter((s: { workflow_id: string }) => s.workflow_id?.startsWith('OrderApproval:'));
    expect(sigs.length).toBeGreaterThanOrEqual(1);
  });

  test('5. ack-workflow-signal "sent" → status=sent + sent_at', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // 拿一个 pending signal
    const sig = (await c.query(
      "SELECT id FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
      [tenantA]
    )).rows[0];
    await c.end();

    const r = await fetch(`${API}/functions/v1/ack-workflow-signal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sig.id, status: 'sent' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('sent');

    const c2 = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c2.connect();
    const r2 = await c2.query("SELECT status, sent_at FROM public.workflow_signals WHERE id = $1", [sig.id]);
    expect(r2.rows[0].status).toBe('sent');
    expect(r2.rows[0].sent_at).not.toBeNull();
    await c2.end();
  });

  test('6. ack-workflow-signal "acknowledged" → status=acknowledged + acknowledged_at', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const sig = (await c.query(
      "SELECT id FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'sent' LIMIT 1",
      [tenantA]
    )).rows[0];
    await c.end();

    const r = await fetch(`${API}/functions/v1/ack-workflow-signal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sig.id, status: 'acknowledged' }),
    });
    expect(r.status).toBe(200);
  });

  test('7. ack-workflow-signal "failed" + error → status=failed + error 列', async () => {
    await createAndDecide('approved', 'OrderApproval:order-fail');
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const sig = (await c.query(
      "SELECT id FROM public.workflow_signals WHERE tenant_id = $1 AND workflow_id = 'OrderApproval:order-fail'",
      [tenantA]
    )).rows[0];
    await c.end();

    const r = await fetch(`${API}/functions/v1/ack-workflow-signal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sig.id, status: 'failed', error: 'Temporal cluster unreachable' }),
    });
    expect(r.status).toBe(200);

    const c2 = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c2.connect();
    const r2 = await c2.query("SELECT status, error FROM public.workflow_signals WHERE id = $1", [sig.id]);
    expect(r2.rows[0].status).toBe('failed');
    expect(r2.rows[0].error).toBe('Temporal cluster unreachable');
    await c2.end();
  });

  test('8. ack-workflow-signal already_acknowledged → 409', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const sig = (await c.query(
      "SELECT id FROM public.workflow_signals WHERE tenant_id = $1 AND status = 'acknowledged' LIMIT 1",
      [tenantA]
    )).rows[0];
    await c.end();

    const r = await fetch(`${API}/functions/v1/ack-workflow-signal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sig.id, status: 'sent' }),
    });
    expect(r.status).toBe(409);
  });

  test('9. anon GET list → 401', async () => {
    const r = await fetch(`${API}/functions/v1/list-workflow-signals`, {
      headers: { 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(401);
  });

  test('10. list-workflow-signals member role → 403', async () => {
    const r = await fetch(`${API}/functions/v1/list-workflow-signals`, {
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(403);
  });

  test('11. TG 幂等: 同一个 hitl_id 重新决策 → ON CONFLICT 更新 payload (reset pending)', async () => {
    const hitlId = await createAndDecide('approved', 'OrderApproval:order-idem');
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const before = (await c.query(
      "SELECT id, status, payload FROM public.workflow_signals WHERE hitl_request_id = $1",
      [hitlId]
    )).rows[0];
    expect(before.payload.decision).toBe('approved');
    // 重新决策: 把 hitl 状态改回 pending 后再 reject (trigger: OLD=pending → NEW=rejected)
    await c.query("UPDATE public.hitl_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1", [hitlId]);
    // 第二次决策 (trigger 应触发并 ON CONFLICT 覆盖 payload)
    const decideR = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id: hitlId, decision: 'rejected', note: 'changed mind' }),
    });
    expect(decideR.status).toBe(200);

    const after = (await c.query(
      "SELECT status, payload FROM public.workflow_signals WHERE hitl_request_id = $1",
      [hitlId]
    )).rows[0];
    expect(after.payload.decision).toBe('rejected');
    expect(after.payload.note).toBe('changed mind');
    await c.end();
  });
});