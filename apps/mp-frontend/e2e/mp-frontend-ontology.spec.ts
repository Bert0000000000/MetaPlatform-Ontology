// e2e/mp-frontend-ontology.spec.ts — mp-frontend /admin/ontology/* (Loop AD: 拆分成 3 个独立子页)
//   1. /admin/ontology/objects 加载 ObjectType 表 + 4 distinct rid
//   2. /admin/ontology/relations 加载 RelationType 表 + 2 distinct rid
//   3. /admin/ontology/actions 加载 ActionType 表 + 2 distinct rid
//   4. (回归) 3 页无未捕获 pageerror

import { test, expect } from '@playwright/test';

test.describe('mp-frontend /admin/ontology/* (Sider 二级菜单拆分)', () => {
  test('1. /admin/ontology/objects 加载 ObjectType 表', async ({ page }) => {
    await page.goto('/admin/ontology/objects');
    await expect(page.locator('h3:has-text("ObjectType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // 抓 rid (限定 .semi-table 内)
    const rids = await page.locator('.semi-table-tbody .semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct ObjectType rids').toBeGreaterThanOrEqual(4);
    for (const rid of ['customer', 'contract', 'order', 'product']) {
      expect(distinct.has(rid), `ObjectType should contain ${rid}`).toBe(true);
    }
  });

  test('2. /admin/ontology/relations 加载 RelationType 表', async ({ page }) => {
    await page.goto('/admin/ontology/relations');
    await expect(page.locator('h3:has-text("RelationType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    const rids = await page.locator('.semi-table-tbody .semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct RelationType rids').toBeGreaterThanOrEqual(2);
    for (const rid of ['customer_has_orders', 'order_contains_products']) {
      expect(distinct.has(rid), `RelationType should contain ${rid}`).toBe(true);
    }
  });

  test('3. /admin/ontology/actions 加载 ActionType 表', async ({ page }) => {
    await page.goto('/admin/ontology/actions');
    await expect(page.locator('h3:has-text("ActionType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    const rids = await page.locator('.semi-table-tbody .semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct ActionType rids').toBeGreaterThanOrEqual(2);
    for (const rid of ['customer.create', 'order.approve']) {
      expect(distinct.has(rid), `ActionType should contain ${rid}`).toBe(true);
    }
  });

  test('4. /admin/ontology 重定向到 /admin/ontology/objects', async ({ page }) => {
    await page.goto('/admin/ontology');
    await page.waitForURL(/\/admin\/ontology\/objects/, { timeout: 5000 });
    await expect(page.locator('h3:has-text("ObjectType")').first()).toBeVisible({ timeout: 10000 });
  });

  test('5. (回归) 3 页无未捕获 pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/ontology/objects');
    await page.waitForTimeout(1500);
    await page.goto('/admin/ontology/relations');
    await page.waitForTimeout(1500);
    await page.goto('/admin/ontology/actions');
    await page.waitForTimeout(1500);
    const fatal = errors.filter((m) => !m.includes('Download the React DevTools'));
    expect(fatal, `unexpected pageerrors: ${fatal.join(' | ')}`).toHaveLength(0);
  });
});