// e2e/ontology-generation.spec.ts
// MetaPlatform M11 Loop 3/3 + M18 — LLM 本体生成 proposal (preview, 不落库)
//
// 覆盖:
//   1. 描述含 "客户 + 订单 + 审批" → 2 ObjectType + 1 Relation + 1 Action
//   2. 描述含 "产品 + 订单" → 2 ObjectType + 1 Relation (order_contains_products)
//   3. 描述含 "发票 + 订单" → 2 ObjectType + 1 Relation (invoice_belongs_to_order)
//   4. 描述含 "合同 + 签署" → 1 ObjectType + 1 Action (contract.sign action_confirm)
//   5. 空描述 → 400
//   6. 描述无任何关键词 → 0 提案 (counts 全 0)
//   7. anon POST → 401
//   8. member role → 403
//   9. 描述过长 (>4000) → 400

import { test, expect } from '@playwright/test';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M11 Loop 3/3 + M18 — Ontology 本体生成 (mock LLM)', () => {
  let adminJwt: string;
  let memberJwt: string;

  test.beforeAll(async () => {
    const c = await import('pg');
    const pg = c.default;
    const conn = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await conn.connect();
    const suffix = Date.now();
    const tenantA = (await conn.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`og-${suffix}`, 'Ontology Generation E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `og-${tag}-${suffix}@x.com`,
          password: 'Test123!',
          email_confirm: true,
          app_metadata: { tenant_id: tenantA, role },
        }),
      });
      const u = await r.json();
      await conn.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)", [u.id, tenantA, u.email, role]);
      return u;
    };
    const admin = await mkUser('admin', 'adm');
    const member = await mkUser('member', 'mem');

    const login = async (email: string) => {
      const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Test123!' }),
      });
      return (await r.json()).access_token;
    };
    adminJwt = await login(admin.email);
    memberJwt = await login(member.email);

    // cleanup hook 留给 afterAll
    (test as unknown as { _cleanup: () => Promise<void> })._cleanup = async () => {
      await conn.query("DELETE FROM public.profiles WHERE id IN ($1, $2)", [admin.id, member.id]);
      await conn.query("DELETE FROM public.tenants WHERE id = $1", [tenantA]);
      await conn.end();
      for (const u of [admin.id, member.id]) {
        try {
          await fetch(`${API}/auth/v1/admin/users/${u}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
          });
        } catch { /* noop */ }
      }
    };
  });

  test.afterAll(async () => {
    const c = (test as unknown as { _cleanup: () => Promise<void> })._cleanup;
    if (c) await c();
  });

  async function gen(description: string, jwt: string | null): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { 'apikey': ANON_KEY, 'Content-Type': 'application/json' };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const r = await fetch(`${API}/functions/v1/generate-ontology-proposal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ description }),
    });
    return { status: r.status, body: await r.json() };
  }

  test('1. 描述含 "客户 + 订单 + 审批" → 2 ObjectType + 1 Relation + 1 Action', async () => {
    const { status, body } = await gen('我需要管理客户信息和订单审批流程. 客户有 email, 订单有 amount.', adminJwt);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const b = body as { proposal: { object_types: Array<{ rid: string }>; relation_types: Array<{ rid: string }>; action_types: Array<{ rid: string }> }; counts: { object_types: number; relation_types: number; action_types: number } };
    expect(b.counts.object_types).toBeGreaterThanOrEqual(2);
    expect(b.counts.relation_types).toBeGreaterThanOrEqual(1);
    expect(b.counts.action_types).toBeGreaterThanOrEqual(1);
    const rids = b.proposal.object_types.map((o) => o.rid);
    expect(rids).toContain('customer');
    expect(rids).toContain('order');
    const relRids = b.proposal.relation_types.map((r) => r.rid);
    expect(relRids).toContain('customer_has_orders');
    const actRids = b.proposal.action_types.map((a) => a.rid);
    expect(actRids).toContain('order.approve');
  });

  test('2. 描述含 "产品 + 订单" → order_contains_products Relation', async () => {
    const { status, body } = await gen('订单包含产品, 产品有 sku 和 price', adminJwt);
    expect(status).toBe(200);
    const b = body as { proposal: { relation_types: Array<{ rid: string }> }; counts: { relation_types: number } };
    expect(b.counts.relation_types).toBeGreaterThanOrEqual(1);
    const relRids = b.proposal.relation_types.map((r) => r.rid);
    expect(relRids).toContain('order_contains_products');
  });

  test('3. 描述含 "发票 + 订单" → invoice_belongs_to_order Relation', async () => {
    const { status, body } = await gen('开具发票属于订单, 发票有 amount', adminJwt);
    expect(status).toBe(200);
    const b = body as { proposal: { relation_types: Array<{ rid: string }> } };
    const relRids = b.proposal.relation_types.map((r) => r.rid);
    expect(relRids).toContain('invoice_belongs_to_order');
  });

  test('4. 描述含 "合同 + 签署" → contract.sign Action (action_confirm HITL)', async () => {
    const { status, body } = await gen('我需要签署合同, 合同有 title 和 amount', adminJwt);
    expect(status).toBe(200);
    const b = body as { proposal: { action_types: Array<{ rid: string; hitl_type?: string }> } };
    const sign = b.proposal.action_types.find((a) => a.rid === 'contract.sign');
    expect(sign).toBeTruthy();
    expect(sign?.hitl_type).toBe('action_confirm');
  });

  test('5. 空描述 → 400', async () => {
    const { status, body } = await gen('', adminJwt);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_description');
  });

  test('6. 描述无关键词 → 0 提案', async () => {
    const { status, body } = await gen('这是一些完全无关的文字 xyz', adminJwt);
    expect(status).toBe(200);
    const b = body as { counts: { object_types: number; relation_types: number; action_types: number } };
    expect(b.counts.object_types).toBe(0);
    expect(b.counts.relation_types).toBe(0);
    expect(b.counts.action_types).toBe(0);
  });

  test('7. anon POST → 401', async () => {
    const { status } = await gen('test description', null);
    expect(status).toBe(401);
  });

  test('8. member role → 403', async () => {
    const { status, body } = await gen('test description', memberJwt);
    expect(status).toBe(403);
    expect((body as { error: string }).error).toBe('forbidden');
  });

  test('9. 描述过长 (>4000) → 400', async () => {
    const long = 'a'.repeat(4001);
    const { status, body } = await gen(long, adminJwt);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('description_too_long');
  });
});