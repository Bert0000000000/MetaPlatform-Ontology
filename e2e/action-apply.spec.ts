// e2e/action-apply.spec.ts
// MetaPlatform M12 ActionType.apply + HITL 三模式 (ADR-0053 §6.4)
//
// 覆盖:
//   1. preview 模式 → 返回 hitl_request_id (action_confirm pending) + preview payload
//   2. confirmed 模式 → 启动 workflow (mock) + workflow_signals 自动落库
//   3. workflow_signals 应由 trigger 自动创建 (confirmed → INSERT hitl approved → trigger 触发)
//   4. permission denied (member 用 admin action) → 403
//   5. invalid action_rid → 404
//   6. invalid mode → 400
//   7. anon → 401
//   8. tenant 内不同 member 用 owner action → 403 (role check 跨角色)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M12 ActionType.apply — preview / confirmed 三模式', () => {
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
      [`aa-${suffix}`, 'Action Apply E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `aa-${tag}-${suffix}@x.com`,
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

  test('1. preview 模式 → 返回 hitl_request_id (action_confirm pending)', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'customer.create',
        target_id: '00000000-0000-0000-0000-000000000001',
        params: { email: 'test@example.com', name: 'Test Co' },
        mode: 'preview',
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('preview');
    expect(body.action_rid).toBe('customer.create');
    expect(body.hitl_request_id).toBeTruthy();
    expect(body.preview.workflow_name).toBe('CustomerCreateWorkflow');
    expect(body.preview.params.email).toBe('test@example.com');

    // 查 DB: hitl status=pending type=action_confirm
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query("SELECT type, status, payload FROM public.hitl_requests WHERE id = $1", [body.hitl_request_id]);
    expect(r2.rows[0].type).toBe('action_confirm');
    expect(r2.rows[0].status).toBe('pending');
    expect(r2.rows[0].payload.action_rid).toBe('customer.create');
    await c.end();
  });

  test('2. confirmed 模式 → 启动 workflow (mock) + workflow_signals 自动落库', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'order.approve',
        target_id: '00000000-0000-0000-0000-000000000002',
        params: { decision: 'approved' },
        mode: 'confirmed',
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('confirmed');
    expect(body.workflow_id).toContain('OrderApprovalWorkflow:order.approve-');
    expect(body.workflow_started).toBe(true);

    // workflow_signals 应由 trigger tg_hitl_to_workflow_signal 自动创建 (hitl status=approved + workflow_id 非空)
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query(
      "SELECT status, workflow_id, payload FROM public.workflow_signals WHERE hitl_request_id = $1",
      [body.hitl_request_id]
    );
    expect(r2.rows.length).toBe(1);
    expect(r2.rows[0].status).toBe('pending');
    expect(r2.rows[0].workflow_id).toBe(body.workflow_id);
    expect(r2.rows[0].payload.decision).toBe('approved');
    await c.end();
  });

  test('3. permission denied: member 用 admin-only action (customer.create) → 403', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'customer.create',  // permission=admin
        target_id: '00000000-0000-0000-0000-000000000003',
        params: { email: 'x' },
        mode: 'preview',
      }),
    });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('forbidden');
    expect(body.message).toContain('admin');
  });

  test('4. invalid action_rid → 404', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'does.not.exist',
        mode: 'preview',
      }),
    });
    expect(r.status).toBe(404);
  });

  test('5. invalid mode → 400', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'customer.create',
        mode: 'invalid_mode',
      }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid_mode');
  });

  test('6. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_rid: 'customer.create', mode: 'preview' }),
    });
    expect(r.status).toBe(401);
  });

  test('7. member 用 owner action (order.approve) → 403', async () => {
    const r = await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'order.approve',  // permission=owner
        mode: 'preview',
      }),
    });
    expect(r.status).toBe(403);
  });
});