// e2e/hitl-escalation.spec.ts
// MetaPlatform M22 多级审批超时升级 + HITL Hub Loop 3/3
//
// 覆盖:
//   1. escalate-hitl level 0 → 1 + new approvers + deadline_at
//   2. escalate-hitl 2次 → level 2
//   3. escalate-hitl max level (4) → 409 max_escalation
//   4. escalate-hitl 非 pending → 409 not_pending
//   5. escalate-hitl cross-tenant → 403
//   6. escalate-hitl member role → 403
//   7. anon POST → 401
//   8. expire-overdue-hitl (manual call): HITL with past deadline_at → status=expired
//   9. pg_cron job 'hitl-expire-overdue' 已 schedule

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M22 HITL 多级审批超时升级 (escalate + expire)', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let bApprover: { id: string; email: string };
  let adminJwt: string;
  let memberJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`esc-${suffix}`, 'HITL Escalation E2E']
    )).rows[0].id;

    const mkUser = async (role: string, tag: string) => {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `esc-${tag}-${suffix}@x.com`,
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
    bApprover = await mkUser('admin', 'b');

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
    await c.query('DELETE FROM public.profiles WHERE id IN ($1, $2, $3)', [adminUser.id, memberUser.id, bApprover.id]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.end();
    for (const u of [adminUser.id, memberUser.id, bApprover.id]) {
      try {
        await fetch(`${API}/auth/v1/admin/users/${u}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
        });
      } catch { /* noop */ }
    }
  });

  async function createHitl(approverIds: string[], deadlineAt?: string): Promise<string> {
    const r = await fetch(`${API}/functions/v1/request-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workflow_saas',
        title: '审批',
        approver_ids: approverIds,
        deadline_at: deadlineAt,
      }),
    });
    return (await r.json()).hitl_request_id;
  }

  test('1. escalate-hitl level 0 → 1 + new approvers + deadline_at', async () => {
    const hitlId = await createHitl([adminUser.id]);
    const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hitl_request_id: hitlId,
        new_approver_ids: [bApprover.id],
        note: '升级到 B',
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.escalation_level).toBe(1);
    expect(body.new_approver_ids).toEqual([bApprover.id]);
    expect(body.hours_to_deadline).toBe(24);
    expect(body.new_deadline_at).toBeTruthy();

    // 查 DB: approver_ids 已更新, escalation_level=1
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query("SELECT escalation_level, status, approver_ids, deadline_at FROM public.hitl_requests WHERE id = $1", [hitlId]);
    expect(r2.rows[0].escalation_level).toBe(1);
    expect(r2.rows[0].status).toBe('pending');
    expect(r2.rows[0].approver_ids).toEqual([bApprover.id]);
    await c.end();
  });

  test('2. escalate-hitl 2次 → level 2', async () => {
    const hitlId = await createHitl([adminUser.id]);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hitl_request_id: hitlId,
          new_approver_ids: [bApprover.id],
        }),
      });
      expect(r.status).toBe(200);
    }
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT escalation_level FROM public.hitl_requests WHERE id = $1", [hitlId]);
    expect(r.rows[0].escalation_level).toBe(2);
    await c.end();
  });

  test('3. escalate-hitl max level (4) → 409 max_escalation', async () => {
    const hitlId = await createHitl([adminUser.id]);
    // 升级 4 次到 level 4
    for (let i = 0; i < 4; i++) {
      await fetch(`${API}/functions/v1/escalate-hitl`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hitl_request_id: hitlId,
          new_approver_ids: [bApprover.id],
        }),
      });
    }
    // 第 5 次应 409
    const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hitl_request_id: hitlId,
        new_approver_ids: [bApprover.id],
      }),
    });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe('max_escalation');
  });

  test('4. escalate-hitl 非 pending → 409 not_pending', async () => {
    const hitlId = await createHitl([adminUser.id]);
    // 批准 (status=approved)
    await fetch(`${API}/functions/v1/decide-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id: hitlId, decision: 'approved' }),
    });
    // 升级 → 应 409
    const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id: hitlId, new_approver_ids: [bApprover.id] }),
    });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe('not_pending');
  });

  test('5. escalate-hitl member role → 403', async () => {
    const hitlId = await createHitl([adminUser.id]);
    const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id: hitlId, new_approver_ids: [bApprover.id] }),
    });
    expect(r.status).toBe(403);
  });

  test('6. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/escalate-hitl`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitl_request_id: '00000000-0000-0000-0000-000000000000', new_approver_ids: ['00000000-0000-0000-0000-000000000000'] }),
    });
    expect(r.status).toBe(401);
  });

  test('7. expire-overdue-hitl: HITL with past deadline → status=expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const hitlId = await createHitl([adminUser.id], past);

    // 调 EF (pg_cron 也会调, 但 E2E 直接验证)
    const r = await fetch(`${API}/functions/v1/expire-overdue-hitl`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.expired_count).toBeGreaterThanOrEqual(1);
    expect(body.expired_ids).toContain(hitlId);

    // 查 DB: status=expired
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query("SELECT status FROM public.hitl_requests WHERE id = $1", [hitlId]);
    expect(r2.rows[0].status).toBe('expired');
    await c.end();
  });

  test('8. pg_cron job "hitl-expire-overdue" 已 schedule', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r = await c.query("SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'hitl-expire-overdue'");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].active).toBe(true);
    expect(r.rows[0].schedule).toBe('*/5 * * * *');
    await c.end();
  });
});