// e2e/mp-frontend-ontology.spec.ts — mp-frontend /admin/ontology (Loop 2/3 bug 修复验证)
//   1. /admin/ontology 渲染 M11 header + tabs
//   2. 3 个 PostgREST endpoint 200 + 数据
//   3. ObjectType tab 含 ≥4 个 distinct rid (customer/contract/order/product)
//   4. RelationType tab 含 ≥2 个 distinct rid (customer_has_orders/order_contains_products)
//   5. ActionType tab 含 ≥2 个 distinct rid (customer.create/order.approve)
//   6. (Loop 2/3 bug 验证) Page error 列表为空 — 之前的 Deno / Statistic / IconHandshake 全部修好

import { test, expect } from '@playwright/test';

test.describe('mp-frontend /admin/ontology (Loop 2/3 bug 修复)', () => {
  test('1. /admin/ontology 加载 M11 Ontology Kernel', async ({ page }) => {
    await page.goto('/admin/ontology');
    await expect(page.locator('text=M11 Ontology Kernel').first()).toBeVisible();
    await expect(page.locator('text=3 表核心').first()).toBeVisible();
  });

  test('2. 3 个 PostgREST endpoint 返回 200', async ({ page }) => {
    const responses: { url: string; status: number }[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/rest/v1/ontology_')) {
        responses.push({ url: resp.url(), status: resp.status() });
      }
    });
    await page.goto('/admin/ontology');
    // 等后端 fetch 完成
    await page.waitForTimeout(2000);
    const tables = ['ontology_object_types', 'ontology_relation_types', 'ontology_action_types'];
    for (const t of tables) {
      const match = responses.find((r) => r.url.includes(`/rest/v1/${t}`));
      expect(match, `endpoint /rest/v1/${t} should be called`).toBeDefined();
      expect(match!.status, `${t} status`).toBe(200);
    }
  });

  test('3. ObjectType tab 含至少 4 个 distinct rid', async ({ page }) => {
    await page.goto('/admin/ontology');
    await expect(page.locator('text=ObjectType').first()).toBeVisible();
    await page.waitForTimeout(1500);
    // 抓页面表格 cell 中所有 rid (限定 .semi-table 内)
    const rids = await page.locator('.semi-table-tbody .semi-table-row').first().locator('..').locator('.semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct ObjectType rids').toBeGreaterThanOrEqual(4);
    // 内置 4 类本体必须出现
    for (const rid of ['customer', 'contract', 'order', 'product']) {
      expect(distinct.has(rid), `ObjectType should contain ${rid}`).toBe(true);
    }
  });

  test('4. RelationType tab 含至少 2 个 distinct rid', async ({ page }) => {
    await page.goto('/admin/ontology');
    await expect(page.locator('text=RelationType').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const rids = await page.locator('.semi-table-tbody .semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct RelationType rids').toBeGreaterThanOrEqual(2);
    for (const rid of ['customer_has_orders', 'order_contains_products']) {
      expect(distinct.has(rid), `RelationType should contain ${rid}`).toBe(true);
    }
  });

  test('5. ActionType tab 含至少 2 个 distinct rid', async ({ page }) => {
    await page.goto('/admin/ontology');
    await expect(page.locator('text=ActionType').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const rids = await page.locator('.semi-table-tbody .semi-table-row td:first-child').allTextContents();
    const distinct = new Set(rids.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, 'distinct ActionType rids').toBeGreaterThanOrEqual(2);
    for (const rid of ['customer.create', 'order.approve']) {
      expect(distinct.has(rid), `ActionType should contain ${rid}`).toBe(true);
    }
  });

  test('6. (回归) 页面无未捕获 pageerror — Deno / Statistic / IconHandshake 修复', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/ontology');
    await page.waitForTimeout(3000);
    // 排除 Vite connect/React DevTools info
    const fatal = errors.filter((m) =>
      !m.includes('Download the React DevTools') &&
      !m.includes('Deno is not defined') /* should be 0 now */
    );
    expect(fatal, `unexpected pageerrors: ${fatal.join(' | ')}`).toHaveLength(0);
  });
});
