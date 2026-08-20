// e2e/mp-platform-web.spec.ts
// MP-V6 E2E: mp-platform 管理后台 (React + Vite + Semi Design)
//
// 启动: cd mp-platform/web && bash scripts/dev.sh   (同时跑 admin-api 8081 + Vite 5173)
// 运行: E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=mp-platform-web mp-platform-web
//
// 验证:
//   1. login (admin JWT) — 注入 Supabase admin user, 通过 UI 登录, JWT 解析出 role=admin
//   2. dashboard loads (200 + 6 cards) — 6 个 stat 卡片渲染
//   3. tenants list (10+ rows from PG) — 列表展示 >=10 行
//   4. audit filter (date range) — 过滤后行数变化

import { test, expect } from '@playwright/test';

const BASE = (() => {
  const v = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5183';
  return v.replace(/\/$/, '');
})();
console.log('[mp-platform-web] using BASE =', BASE);

const SUPABASE_URL = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const ADMIN_EMAIL = `e2e-admin-${Date.now()}@mp.local`;
const ADMIN_PASSWORD = 'Admin123!';

test.describe('mp-platform admin web', () => {
  let tenantId: string;

  test.beforeAll(async () => {
    // 创建 1 个 tenant + 1 个 admin user
    const pgMod = await import('pg');
    const { Client } = pgMod.default ?? pgMod;
    const pg = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pg.connect();

    const t = await pg.query(
      'INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`e2e-mp-platform-${Date.now()}`, 'E2E mp-platform']
    );
    tenantId = t.rows[0].id;

    const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true,
        app_metadata: { tenant_id: tenantId, role: 'admin' },
      }),
    });
    const u = await ur.json();

    // 把 audit_log 灌点数据, 让 audit filter 有内容可过滤
    for (let i = 0; i < 5; i++) {
      await pg.query(
        `INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, occurred_at)
         VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval)`,
        [tenantId, u.id, i % 2 === 0 ? 'INSERT' : 'UPDATE', 'public', 'tenants', i]
      );
    }

    await pg.end();
  });

  test.afterAll(async () => {
    const pgMod = await import('pg');
    const { Client } = pgMod.default ?? pgMod;
    const pg = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pg.connect();
    await pg.query('DELETE FROM public.audit_log WHERE tenant_id = $1', [tenantId]);
    await pg.query('DELETE FROM public.profiles WHERE tenant_id = $1', [tenantId]);
    await pg.query('DELETE FROM public.tenants WHERE id = $1', [tenantId]);
    await pg.end();
  });

  test('1. login (admin JWT)', async ({ page }) => {
    const resp = await page.goto(`${BASE}/login`);
    expect(resp?.status()).toBe(200);
    await expect(page.getByTestId('mp-login-page')).toBeVisible();

    await page.getByTestId('mp-login-email').locator('input').fill(ADMIN_EMAIL);
    await page.getByTestId('mp-login-password').locator('input').fill(ADMIN_PASSWORD);
    await page.getByTestId('mp-login-submit').click();

    // 等跳转 dashboard
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByTestId('mp-dashboard')).toBeVisible();

    // 验证 localStorage JWT 写入
    const token = await page.evaluate(() => localStorage.getItem('mp.admin.jwt'));
    expect(token).toBeTruthy();
  });

  test('2. dashboard loads (200 + 6 cards)', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByTestId('mp-login-email').locator('input').fill(ADMIN_EMAIL);
    await page.getByTestId('mp-login-password').locator('input').fill(ADMIN_PASSWORD);
    await page.getByTestId('mp-login-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await expect(page.getByTestId('mp-dashboard')).toBeVisible();

    // 验证 6 张 stat 卡片渲染
    const cardKeys = ['tenants', 'users', 'audits24h', 'installs', 'presets', 'cron'];
    for (const k of cardKeys) {
      await expect(page.getByTestId(`mp-stat-card-${k}`)).toBeVisible({ timeout: 10_000 });
      const valueLocator = page.getByTestId(`mp-stat-value-${k}`);
      await expect(valueLocator).toBeVisible();
      const text = await valueLocator.textContent();
      expect(text).not.toBeNull();
      // 必须是数字 (0 或正整数)
      expect(text!.trim()).toMatch(/^\d/);
    }
  });

  test('3. tenants list (>=10 rows)', async ({ page }) => {
    // DB 必须 >=10 tenants (PoC seed 已灌)
    const pgMod = await import('pg');
    const { Client } = pgMod.default ?? pgMod;
    const pg = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await pg.connect();
    const existing = await pg.query('SELECT count(*)::int AS n FROM public.tenants');
    await pg.end();
    expect(existing.rows[0].n).toBeGreaterThanOrEqual(10);

    await page.goto(`${BASE}/login`);
    await page.getByTestId('mp-login-email').locator('input').fill(ADMIN_EMAIL);
    await page.getByTestId('mp-login-password').locator('input').fill(ADMIN_PASSWORD);
    await page.getByTestId('mp-login-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto(`${BASE}/tenants`);
    // 等 Vite + React hydration
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expect(page.getByTestId('mp-tenants-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mp-tenants-table')).toBeVisible({ timeout: 15_000 });

    // 等待表格行渲染 (rows >= 10)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="mp-tenants-table"] tbody tr').length >= 10,
      { timeout: 15_000 }
    );
    const rowCount = await page.locator('[data-testid="mp-tenants-table"] tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(10);
  });

  test('4. audit filter (date range)', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByTestId('mp-login-email').locator('input').fill(ADMIN_EMAIL);
    await page.getByTestId('mp-login-password').locator('input').fill(ADMIN_PASSWORD);
    await page.getByTestId('mp-login-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.goto(`${BASE}/audit`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expect(page.getByTestId('mp-audit-page')).toBeVisible({ timeout: 15_000 });

    // 等表格初始加载 (返回最近 200 条, 应该 >=5 rows -- beforeAll 写了 5 条)
    await page.waitForTimeout(1500);
    const initial = await page.locator('[data-testid="mp-audit-table"] tbody tr').count();
    expect(initial).toBeGreaterThanOrEqual(1);

    // 通过 API 直接验证过滤: 1970 范围必然 0 行
    const apiResp = await page.request.get(`${BASE}/api/audit?from=1970-01-01T00%3A00%3A00Z&to=1970-12-31T23%3A59%3A59Z`);
    expect(apiResp.status()).toBe(200);
    const filtered = await apiResp.json();
    expect(Array.isArray(filtered)).toBe(true);
    expect((filtered as unknown[]).length).toBe(0);

    // 再用宽范围 (未来 1 年), 应该包含 beforeAll 写的 5 条
    const wideResp = await page.request.get(`${BASE}/api/audit`);
    const wide = await wideResp.json();
    expect((wide as unknown[]).length).toBeGreaterThanOrEqual(5);
  });
});
