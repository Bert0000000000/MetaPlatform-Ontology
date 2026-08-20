// e2e/ontology-crud.spec.ts
// MetaPlatform M11 Ontology Kernel Loop 2/3 — list / get / create EF
//
// 覆盖:
//   1. list-ontology-types default → ontology_object_types (4 seed)
//   2. list-ontology-types?type=relation → 2 seed relations
//   3. list-ontology-types?type=action → 2 seed actions
//   4. get-ontology-type?type=object&rid=customer → 1 row
//   5. get-ontology-type?type=object&rid=notfound → 404
//   6. create-ontology-type 新 ObjectType → 201 + audit_log
//   7. create-ontology-type 新 Relation → 201
//   8. create-ontology-type 新 Action (含 hitl_type + workflow_name) → 201
//   9. create-ontology-type member role → 403
//  10. anon POST → 401
//  11. invalid type → 400

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M11 Ontology Kernel Loop 2/3 — CRUD Edge Functions', () => {
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
      [`oc-${suffix}`, 'Ontology CRUD E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `oc-${tag}-${suffix}@x.com`,
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
    await c.query('DELETE FROM public.ontology_object_types WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.ontology_relation_types WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.ontology_action_types WHERE tenant_id = $1', [tenantA]);
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

  test('1. list-ontology-types default → 4 seed ObjectTypes', async () => {
    const r = await fetch(`${API}/functions/v1/list-ontology-types?status=active`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.type).toBe('object');
    expect(body.count).toBeGreaterThanOrEqual(4);
    const rids = body.results.map((x: { rid: string }) => x.rid).sort();
    expect(rids).toContain('customer');
    expect(rids).toContain('order');
  });

  test('2. list-ontology-types?type=relation → 2 seed relations', async () => {
    const r = await fetch(`${API}/functions/v1/list-ontology-types?type=relation`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.type).toBe('relation');
    expect(body.count).toBeGreaterThanOrEqual(2);
    const rids = body.results.map((x: { rid: string }) => x.rid);
    expect(rids).toContain('customer_has_orders');
  });

  test('3. list-ontology-types?type=action → 2 seed actions', async () => {
    const r = await fetch(`${API}/functions/v1/list-ontology-types?type=action`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.type).toBe('action');
    expect(body.count).toBeGreaterThanOrEqual(2);
    const rids = body.results.map((x: { rid: string }) => x.rid);
    expect(rids).toContain('customer.create');
    expect(rids).toContain('order.approve');
  });

  test('4. get-ontology-type?type=object&rid=customer → 200', async () => {
    const r = await fetch(`${API}/functions/v1/get-ontology-type?type=object&rid=customer`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.rid).toBe('customer');
    expect(body.name).toBe('客户');
    expect(body.status).toBe('active');
  });

  test('5. get-ontology-type not found → 404', async () => {
    const r = await fetch(`${API}/functions/v1/get-ontology-type?type=object&rid=does_not_exist`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(404);
  });

  test('6. create-ontology-type 新 ObjectType → 201 + audit_log', async () => {
    const r = await fetch(`${API}/functions/v1/create-ontology-type`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'object',
        rid: 'invoice',
        slug: 'invoice',
        name: '发票',
        properties: { amount: { type: 'number', required: true } },
        status: 'active',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.rid).toBe('invoice');

    // audit_log 应该 INSERT 落库
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const audit = await c.query(
      "SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id = $1 AND table_name = 'ontology_object_types' AND action = 'INSERT' AND new_values->>'rid' = 'invoice'",
      [tenantA]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    await c.end();
  });

  test('7. create-ontology-type 新 Relation → 201', async () => {
    const r = await fetch(`${API}/functions/v1/create-ontology-type`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'relation',
        rid: 'invoice_belongs_to_order',
        name: '发票属于订单',
        from_type: 'invoice',
        to_type: 'order',
        cardinality: 'many_to_one',
        status: 'active',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.cardinality).toBe('many_to_one');
  });

  test('8. create-ontology-type 新 Action (含 workflow + hitl) → 201', async () => {
    const r = await fetch(`${API}/functions/v1/create-ontology-type`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'action',
        rid: 'invoice.approve',
        name: '审批发票',
        target_type: 'invoice',
        parameters: { invoice_id: 'uuid', decision: 'string' },
        permission: 'owner',
        workflow_name: 'InvoiceApprovalWorkflow',
        hitl_type: 'workflow_saas',
        status: 'active',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.workflow_name).toBe('InvoiceApprovalWorkflow');
    expect(body.hitl_type).toBe('workflow_saas');
  });

  test('9. create-ontology-type member role → 403', async () => {
    const r = await fetch(`${API}/functions/v1/create-ontology-type`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'object',
        rid: 'forbidden_test',
        slug: 'forbidden_test',
        name: 'Forbidden',
        status: 'draft',
      }),
    });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('forbidden');
  });

  test('10. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/create-ontology-type`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'object', rid: 'x', slug: 'x', name: 'x' }),
    });
    expect(r.status).toBe(401);
  });

  test('11. invalid type → 400', async () => {
    const r = await fetch(`${API}/functions/v1/list-ontology-types?type=invalid`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(400);
  });
});