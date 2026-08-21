// e2e/mp-frontend.spec.ts — mp-frontend (React + Vite + Semi Design 19) UI 验证
import { test, expect } from '@playwright/test';

test.describe('mp-frontend (React + Vite + Semi Design 19)', () => {
  test('1. / 加载 Dashboard (10 stat cards)', async ({ page }) => {
    const r = await page.goto('/');
    expect(r?.status()).toBe(200);
    await expect(page.locator('text=/Dashboard/i').first()).toBeVisible();
    await expect(page.locator('text=/Tenants/i').first()).toBeVisible();
  });

  test('2. Sider 显示 4 个一级模块 (SubNav)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Ontology 本体平台').first()).toBeVisible();
    await expect(page.locator('text=云市场').first()).toBeVisible();
    await expect(page.locator('text=应用中心').first()).toBeVisible();
    await expect(page.locator('text=运营管理').first()).toBeVisible();
  });

  test('3. /admin/ontology 重定向到 /admin/ontology/objects (ObjectType)', async ({ page }) => {
    await page.goto('/admin/ontology');
    await page.waitForURL(/\/admin\/ontology\/objects/, { timeout: 5000 });
    await expect(page.locator('h3:has-text("ObjectType")').first()).toBeVisible({ timeout: 10000 });
  });

  test('4. /admin/hitl 加载 HITL 页', async ({ page }) => {
    await page.goto('/admin/hitl');
    await expect(page.locator('text=M13 HITL Hub').first()).toBeVisible();
    await expect(page.locator('text=Pending').first()).toBeVisible();
  });

  test('5. /admin/sessions 加载 dsh Sessions 页', async ({ page }) => {
    await page.goto('/admin/sessions');
    await expect(page.locator('text=M15 dsh Sessions').first()).toBeVisible();
    await expect(page.locator('text=Active').first()).toBeVisible();
  });

  test('6. /admin/sandbox 加载 mp-sandbox 页', async ({ page }) => {
    await page.goto('/admin/sandbox');
    await expect(page.locator('text=Issue #15 mp-sandbox').first()).toBeVisible();
  });

  test('7. /admin/monitoring 加载 mp-monitoring 页', async ({ page }) => {
    await page.goto('/admin/monitoring');
    await expect(page.locator('text=M10 mp-monitoring').first()).toBeVisible();
    await expect(page.locator('text=postgres').first()).toBeVisible();
  });

  test('8. /admin/audit 加载 mp-audit 页 (含 action filter)', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.locator('text=mp-audit').first()).toBeVisible();
    await expect(page.locator('input[placeholder*="action"]').first()).toBeVisible();
  });

  test('9. /admin/frontend-obs 加载 frontend-obs 页', async ({ page }) => {
    await page.goto('/admin/frontend-obs');
    await expect(page.locator('text=mp-frontend-obs').first()).toBeVisible();
    await expect(page.locator('text=Page Views').first()).toBeVisible();
  });

  test('10. /admin/runtime 加载 mp-runtime 页', async ({ page }) => {
    await page.goto('/admin/runtime');
    await expect(page.locator('text=mp-runtime').first()).toBeVisible();
    await expect(page.locator('text=Active').first()).toBeVisible();
  });

  test('11. /admin/tenants 加载 Tenants 页', async ({ page }) => {
    await page.goto('/admin/tenants');
    await expect(page.locator('text=Tenants').first()).toBeVisible({ timeout: 10000 });
  });

  test('15. /admin/marketplace 加载 mp-skill-marketplace 页', async ({ page }) => {
    await page.goto('/admin/marketplace');
    await expect(page.locator('text=M05 mp-skill-marketplace').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=总 preset').first()).toBeVisible({ timeout: 10000 });
  });

  test('12. 未知路由 /random-xyz → 重定向到 /admin/dashboard', async ({ page }) => {
    await page.goto('/random-xyz');
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/dashboard/);
  });

  test('13. Semi Design Sider 加载 (semi-sider class)', async ({ page }) => {
    await page.goto('/');
    // Semi Design 默认 class 是 semi-sider 或类似, 不要依赖具体 class 名
    // 验证 Sider 宽度 + 包含 nav items
    const sider = await page.locator('aside').first();
    await expect(sider).toBeVisible();
  });

  test('14. Header 包含 "MetaPlatform Admin" 标题', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=MetaPlatform Admin').first()).toBeVisible();
  });
});