// e2e/admin-server.spec.ts
// MetaPlatform admin-server (port 8080) smoke test
//   1. homepage /  → 200 + Ontology 本体平台 PoC 标题
//   2. /admin → 200 + nav links
//   3. /admin/tenants → 200 + 表格
//   4. /admin/sandbox → 200 + mp_sandbox.executions 表 (Issue #15 Loop 2/3)
//   5. /app-center → 200 + preset 列表

import { test, expect } from '@playwright/test';

const ADMIN = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8080';

test.describe('admin-server smoke (port 8080)', () => {
  test('1. / returns dashboard', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('Ontology 本体平台');
    expect(html).toContain('Tenants');
  });

  test('2. /admin/tenants lists tenants', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/tenants`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('<table>');
  });

  test('3. /admin/sandbox shows executions table (Issue #15 Loop 2/3)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/sandbox`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('mp-sandbox 执行统计');
    expect(html).toContain('最近 50 次执行');
    expect(html).toContain('mp_sandbox.executions');
  });

  test('4. /app-center lists presets', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/app-center`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('MetaPlatform 应用中心');
  });

  test('5. /admin includes sandbox nav link', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('/admin/sandbox');
    expect(html).toContain('mp-sandbox 执行');
  });

  // Loop K: M11 Ontology / HITL / dsh Sessions UI
  test('6. /admin/ontology shows M11 kernel stats + recent', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/ontology`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('M11 Ontology Kernel');
    expect(html).toContain('ObjectType');
    expect(html).toContain('RelationType');
    expect(html).toContain('ActionType');
    expect(html).toContain('最近 ObjectType');
  });

  test('7. /admin/hitl shows HITL Hub stats + workflow_signals', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/hitl`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('HITL Hub');
    expect(html).toContain('Pending');
    expect(html).toContain('workflow_saas');
    expect(html).toContain('escalate-hitl');
  });

  test('8. /admin/sessions shows M15 dsh session stats', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/sessions`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('dsh Session Postgres Backend');
    expect(html).toContain('dsh-session-create');
    expect(html).toContain('dsh-session-cleanup');
  });

  test('9. /admin includes all new nav links', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    const html = await r.text();
    expect(html).toContain('/admin/ontology');
    expect(html).toContain('/admin/hitl');
    expect(html).toContain('/admin/sessions');
  });
});