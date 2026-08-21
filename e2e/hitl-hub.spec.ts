// e2e/hitl-hub.spec.ts
// MetaPlatform HITL Hub (ADR-0053 §7.9) — 4 类型联动中枢 E2E
//
// 4 类型:
//   - workflow_saas   业务用户 → 钉钉 / 飞书 / 企微
//   - workflow_dsh    业务用户 → dsh Web 内联审批
//   - tool_dsh        数字员工用户 → dsh Web 弹窗 (tool 调用拦截)
//   - action_confirm  数字员工用户 → dsh Web 预览 (ActionType.apply mode='preview')
//
// 覆盖:
//   1. request-hitl workflow_saas 创建 → 201 + 返回 hitl_request_id
//   2. list-pending-hitl 当前用户的待审批列表 → 含刚才创建的
//   3. decide-hitl approved → 200 + status 变更
//   4. decide-hitl 二次决 → 409 already_decided
//   5. decide-hitl 非 approver → 403
//   6. request-hitl type=action_confirm + payload.preview (preview mode)
//   7. anon POST → 401
//   8. tg_audit 触发器 → audit_log 落库 (status INSERT/UPDATE)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('HITL Hub (ADR-0053)', () => {
  let tenantA: string;
  let requester: { id: string; email: string };
  let approver: { id: string; email: string };
  let requesterJwt: string;
  let approverJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`hitl-${suffix}`, 'HITL Hub E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `hitl-${tag}-${suffix}@x.com`,
          password: 'Test123!',
          email_confirm: true,
          app_metadata: { tenant_id: tenantA, role },
        }),
      });
      const u = await r.json();
      await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)", [u.id, tenantA, u.email, role]);
      return u;
    };
    requester = await mkUser('admin', 'req');
    approver = await mkUser('admin', 'apr');

    const login = async (email: string) => {
      const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Test123!' }),
      });
      return (await r.json()).access_token;
    };
    requesterJwt = await login(requester.email);
    approverJwt = await login(approver.email);
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query('DELETE FROM public.hitl_requests WHERE tenant_id = $1', [tenantA]);
    await c.query("DELETE FROM public.audit_log WHERE tenant_id = $1 AND schema_name = 'public' AND table_name = 'hitl_requests'", [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id IN ($1, $2)', [requester.id, approver.id]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.end();
    for (const u of [requester.id, approver.id]) {
      try {
        await fetch(`${API}/auth/v1/admin/users/${u}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
        });
      } catch { /* noop */ }
    }
  });

  test('1. request-hitl workflow_saas create → 201 + hitl_request_id', async () => {
    const r = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: '订单审批 / Order #12345',
        description: '客户申请 50K RMB 折扣',
        approver_ids: [approver.id],
        payload: { order_id: '12345', amount: 50000, currency: 'CNY' },
        workflow_id: 'wf-test-001',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.hitl_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe('pending');
  });

  test('2. list-pending-hitl → requester 创建, approver 看得到', async () => {
    // requester 创建
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_dsh',
        title: 'NDA 草稿 / Acme Corp',
        approver_ids: [approver.id],
        payload: { contract_id: 'c-001' },
      }),
    });
    expect(createR.status).toBe(201);
    const { hitl_request_id } = await createR.json();

    // approver 查询
    const listR = await fetch(`${API}/functions/v1/list-pending-hitl?limit=50`, {
      headers: { 'Authorization': `Bearer ${approverJwt}`, 'apikey': ANON_KEY },
    });
    expect(listR.status).toBe(200);
    const listBody = await listR.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.count).toBeGreaterThanOrEqual(1);
    const ids = listBody.results.map((r: { id: string }) => r.id);
    expect(ids).toContain(hitl_request_id);
  });

  test('3. decide-hitl approved → status 变更 + audit_log', async () => {
    // requester 创建
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tool_dsh',
        title: '调 exec rm 工具 / dangerous',
        approver_ids: [approver.id],
        payload: { tool_call: { name: 'exec', args: { cmd: 'rm -rf /tmp/test' } } },
      }),
    });
    const { hitl_request_id } = await createR.json();

    // approver 批准
    const decideR = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${approverJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hitl_request_id,
        decision: 'approved',
        note: 'safe rm in /tmp',
      }),
    });
    expect(decideR.status).toBe(200);
    const decideBody = await decideR.json();
    expect(decideBody.status).toBe('approved');
    expect(decideBody.workflow_id).toBeNull();

    // audit_log 应有 INSERT + UPDATE 两条 (tg_audit 触发器)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND table_name = 'hitl_requests'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
    await c.end();
  });

  test('4. decide-hitl 二次决 → 409 already_decided', async () => {
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'action_confirm',
        title: 'Action 预览 / Update ontology',
        approver_ids: [approver.id],
        payload: { preview: { action: 'update_object_type', params: { rid: 'customer' } } },
      }),
    });
    const { hitl_request_id } = await createR.json();

    // 第一次批准
    const r1 = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${approverJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision: 'approved' }),
    });
    expect(r1.status).toBe(200);

    // 第二次拒绝 → 409
    const r2 = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${approverJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision: 'rejected' }),
    });
    expect(r2.status).toBe(409);
    const body = await r2.json();
    expect(body.error).toBe('already_decided');
  });

  test('5. decide-hitl 非 approver → 403', async () => {
    const createR = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: '订单 / 仅 approver 可决',
        approver_ids: [approver.id],     // 只给 approver
      }),
    });
    const { hitl_request_id } = await createR.json();

    // requester 试图决 → 403
    const decideR = await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id, decision: 'approved' }),
    });
    expect(decideR.status).toBe(403);
    const body = await decideR.json();
    expect(body.error).toBe('forbidden');
  });

  test('6. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: 'anon attempt',
        approver_ids: ['00000000-0000-0000-0000-000000000001'],
      }),
    });
    expect(r.status).toBe(401);
  });

  test('7. invalid type → 400', async () => {
    const r = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requesterJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invalid_type',
        title: 'bad type',
        approver_ids: [approver.id],
      }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid_type');
  });
});