// e2e/supabase-auth.spec.ts
// MP-V6 E2E: Supabase Auth + RLS 跨租户隔离验证
//
// 验证:
//   1. signup + login 流程
//   2. JWT 含 tenant_id + role claims
//   3. 两个 tenant 互相看不到对方数据
//
// 运行: pnpm exec playwright test supabase-auth

import { test, expect, request } from '@playwright/test';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJ...ANON_PLACEHOLDER';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJ...SERVICE_PLACEHOLDER';

test.describe('Supabase Auth + RLS', () => {
  let tenantA: string;
  let tenantB: string;
  let userAJwt: string;
  let userBJwt: string;

  test.beforeAll(async () => {
    // 用 service_role 创建 2 个 tenant + 2 个用户
    const pg = await import('pg');
    const { Client } = pg.default ?? pg;
    const pgClient = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();

    const suffix = Date.now();
    tenantA = (await pgClient.query(
      'INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`e2e-a-${suffix}`, 'E2E A']
    )).rows[0].id;
    tenantB = (await pgClient.query(
      'INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`e2e-b-${suffix}`, 'E2E B']
    )).rows[0].id;

    // 创建 users + profiles
    for (const [email, tid] of [[`e2e-a-${suffix}@x.com`, tenantA], [`e2e-b-${suffix}@x.com`, tenantB]]) {
      const r = await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, password: 'Test123!', email_confirm: true,
          app_metadata: { tenant_id: tid, role: 'admin' },
        }),
      });
      const u = await r.json();
      await pgClient.query(
        'INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)',
        [u.id, tid, u.email, 'admin']
      );
    }

    await pgClient.end();
  });

  test.afterAll(async () => {
    // 清理
    const pg = await import('pg');
    const { Client } = pg.default ?? pg;
    const pgClient = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    await pgClient.query('DELETE FROM public.audit_log WHERE tenant_id IN ($1, $2) ', [tenantA, tenantB]);
    await pgClient.query('DELETE FROM public.profiles WHERE tenant_id IN ($1, $2) ', [tenantA, tenantB]);
    await pgClient.query('DELETE FROM public.tenants WHERE id IN ($1, $2) ', [tenantA, tenantB]);
    await pgClient.end();
  });

  test('1. signup + login returns JWT with tenant_id + role claims', async () => {
    // Login userA
    const email = await fetch(`${API}/auth/v1/admin/users?page=1&per_page=100`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    });
    const users = await email.json();
    const userA = users.users.find((u: { app_metadata: { tenant_id: string } }) => u.app_metadata?.tenant_id === tenantA);

    const loginR = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    const login = await loginR.json();
    expect(loginR.status).toBe(200);
    expect(login.access_token).toBeTruthy();

    // 解码 JWT
    const parts = login.access_token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    expect(payload.tenant_id).toBe(tenantA);
    expect(payload.role).toBe('admin');
    expect(payload.sub).toBe(userA.id);

    userAJwt = login.access_token;
  });

  test('2. create-customer in tenant A only visible to A', async () => {
    // 1. userA 登录
    const users = await (await fetch(`${API}/auth/v1/admin/users?page=1&per_page=100`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    })).json();
    const uA = users.users.find((u: { app_metadata: { tenant_id: string } }) => u.app_metadata?.tenant_id === tenantA);
    const uB = users.users.find((u: { app_metadata: { tenant_id: string } }) => u.app_metadata?.tenant_id === tenantB);

    const jwtA = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uA.email, password: 'Test123!' }),
    })).json()).access_token;
    const jwtB = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uB.email, password: 'Test123!' }),
    })).json()).access_token;
    userAJwt = jwtA; userBJwt = jwtB;

    // 2. userA 创建 customer
    const createR = await fetch(`${API}/functions/v1/create-customer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtA}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Customer A',
        contact_email: `c-a-${Date.now()}@x.com`,
      }),
    });
    expect(createR.status()).toBe(201);
    const customer = await createR.json();
    expect(customer.customer.tenant_id).toBe(tenantA);

    // 3. userB 查询 customers (RLS 应过滤, 看不到 A 的)
    const listR = await fetch(`${API}/rest/v1/customers?select=id,name,tenant_id&limit=100`, {
      headers: { 'Authorization': `Bearer ${jwtB}`, 'apikey': ANON_KEY },
    });
    const list = await listR.json();
    expect(Array.isArray(list)).toBe(true);
    const customersInB = list.filter((c: { tenant_id: string }) => c.tenant_id === tenantB);
    const customersFromA = list.filter((c: { tenant_id: string }) => c.tenant_id === tenantA);
    expect(customersFromA).toHaveLength(0);  // RLS 隔离
    expect(customersInB.length).toBeGreaterThanOrEqual(0);
  });

  test('3. pg_cron jobs are scheduled', async () => {
    const pg = await import('pg');
    const { Client } = pg.default ?? pg;
    const pgClient = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pgClient.connect();
    const r = await pgClient.query('SELECT count(*)::int AS n FROM cron.job WHERE active = true');
    expect(r.rows[0].n).toBeGreaterThan(5);  // 至少 5+ cron jobs
    await pgClient.end();
  });
});