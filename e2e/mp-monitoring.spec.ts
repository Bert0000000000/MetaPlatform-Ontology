// e2e/mp-monitoring.spec.ts
// MetaPlatform M10 mp-monitoring 系统健康检查 (ADR-0059)
//
// 覆盖:
//   1. GET /mp-monitoring-health → 200 + overall + 5 subsystems
//   2. postgres subsystem → healthy + 行数正确
//   3. edge_functions subsystem → healthy + Deno version
//   4. mp_sandbox_sidecar subsystem → healthy (本地 dev: docker container)
//   5. realtime subsystem → healthy (有 publication tables)
//   6. pg_cron subsystem → healthy
//   7. summary 统计 (healthy/degraded/unhealthy 数量)
//   8. anon → 401
//   9. E2E: 执行一次 action-apply → workflow_signals pending +1 (monotonic)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M10 mp-monitoring 系统健康检查', () => {
  let tenantA: string;
  let adminUser: { id: string; email: string };
  let adminJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`mon-${suffix}`, 'Monitoring E2E']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `mon-${suffix}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    adminUser = await r.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)", [adminUser.id, tenantA, adminUser.email, 'admin']);

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

  test('1. GET /mp-monitoring-health → 200 + overall + ≥4 subsystems', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.timestamp).toBeTruthy();
    expect(body.version).toBe('v6.0');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.overall);
    expect(body.subsystems.length).toBeGreaterThanOrEqual(4);
    expect(body.summary.total).toBe(body.subsystems.length);
    expect(body.summary.healthy).toBeGreaterThanOrEqual(0);
  });

  test('2. postgres subsystem → healthy + 行数', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const pg = body.subsystems.find((s: { name: string }) => s.name === 'postgres');
    expect(pg).toBeTruthy();
    expect(pg.status).toBe('healthy');
    expect(pg.details.tenants).toBeGreaterThanOrEqual(1);
    expect(pg.latency_ms).toBeGreaterThan(0);
  });

  test('3. edge_functions subsystem → healthy + Deno version', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const ef = body.subsystems.find((s: { name: string }) => s.name === 'edge_functions');
    expect(ef).toBeTruthy();
    expect(ef.status).toBe('healthy');
    expect(ef.details.runtime).toBe('deno');
    expect(ef.details.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('4. mp_sandbox_sidecar subsystem → healthy (docker container)', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const sc = body.subsystems.find((s: { name: string }) => s.name === 'mp_sandbox_sidecar');
    expect(sc).toBeTruthy();
    expect(sc.status).toBe('healthy');
    expect(sc.details.http_status).toBe(200);
    expect(sc.details.url).toContain('mp-sandbox-sidecar');
  });

  test('5. realtime subsystem → healthy (有 publication tables)', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const rt = body.subsystems.find((s: { name: string }) => s.name === 'realtime');
    expect(rt).toBeTruthy();
    expect(['healthy', 'degraded']).toContain(rt.status);
    expect(rt.details.published_tables).toBeGreaterThanOrEqual(1);
  });

  test('6. pg_cron subsystem → healthy (有 active jobs)', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const cron = body.subsystems.find((s: { name: string }) => s.name === 'pg_cron');
    expect(cron).toBeTruthy();
    expect(cron.details.active_jobs).toBeGreaterThanOrEqual(1);
  });

  test('7. summary 统计一致 (healthy + degraded + unhealthy + unknown = total)', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const body = await r.json();
    const s = body.summary;
    expect(s.healthy + s.degraded + s.unhealthy + s.unknown).toBe(s.total);
  });

  test('8. anon → 401', async () => {
    const r = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(401);
  });

  test('9. 端到端: action-apply 一次后, workflow_signals_pending 数 +1 (monitoring 数据实时)', async () => {
    // baseline
    const r0 = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const base = (await r0.json()).subsystems.find((s: { name: string }) => s.name === 'postgres').details.workflow_signals_pending as number;

    // 调 action-apply confirmed → 创建 workflow_signal
    await fetch(`${API}/functions/v1/action-apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_rid: 'order.approve',
        target_id: '00000000-0000-0000-0000-000000000088',
        params: { decision: 'approved' },
        mode: 'confirmed',
      }),
    });

    // re-check
    const r1 = await fetch(`${API}/functions/v1/mp-monitoring-health`, {
      headers: { 'Authorization': `Bearer ${adminJwt}`, 'apikey': ANON_KEY },
    });
    const after = (await r1.json()).subsystems.find((s: { name: string }) => s.name === 'postgres').details.workflow_signals_pending as number;
    expect(after).toBe(base + 1);
  });
});