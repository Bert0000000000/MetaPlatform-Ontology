// e2e/admin-server.spec.ts
// MetaPlatform admin-server (port 8080) + Semi Design 19 UI 验证
//   1. /  → 200 + Dashboard (statistic cards + Sider nav + Header)
//   2-8. 各模块页面 → 200 + 验证 Semi 组件 (mp-table, mp-tag, mp-stat-card, mp-sider 等)
//   9-11. Sider nav + active 高亮 + statistic count

import { test, expect } from '@playwright/test';

const ADMIN = process.env.ADMIN_BASE ?? 'http://127.0.0.1:8080';

test.describe('admin-server smoke (port 8080) + Semi Design 19', () => {
  test('1. / returns dashboard (Sider + Header + Content + Footer)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('MetaPlatform');
    expect(html).toContain('Semi Design');
    // 验证 Semi Design layout (Sider + Header + Content + Footer)
    expect(html).toContain('mp-shell');
    expect(html).toContain('mp-sider');
    expect(html).toContain('mp-header');
    expect(html).toContain('mp-content');
    expect(html).toContain('mp-footer');
    // 验证 statistic cards
    expect(html).toContain('mp-stat-card');
    expect(html).toContain('mp-stat-value');
    // 验证 nav items (Sider 含所有 10 个入口)
    expect(html).toContain('Ontology');
    expect(html).toContain('HITL');
    expect(html).toContain('dsh');
    // 验证 dashboard 主统计
    expect(html).toContain('Tenants');
    expect(html).toContain('mp-sandbox');
  });

  test('2. /admin/tenants lists tenants (Semi Table)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/tenants`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('mp-table');
  });

  test('3. /admin/sandbox shows executions table (Issue #15 Loop 2/3)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/sandbox`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('mp-sandbox');
    expect(html).toContain('mp-table');
  });

  test('4. /app-center lists presets', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/app-center`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('MetaPlatform');
  });

  test('5. /admin includes sandbox nav link', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('mp-sandbox');
  });

  // Loop K + Semi UI: M11 Ontology / HITL / dsh Sessions pages
  test('6. /admin/ontology shows M11 kernel stats + recent (Semi Tag/Statistic)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/ontology`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('M11 Ontology Kernel');
    expect(html).toContain('ObjectType (active)');
    expect(html).toContain('RelationType (active)');
    expect(html).toContain('ActionType (active)');
    // 验证 Semi Tag (status badge) + Statistic
    expect(html).toContain('mp-tag');
    expect(html).toContain('mp-stat-value');
    expect(html).toContain('mp-table');
  });

  test('7. /admin/hitl shows HITL Hub stats + workflow_signals (Semi Tag colors)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/hitl`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('HITL Hub');
    expect(html).toContain('Pending');
    expect(html).toContain('workflow_saas');
    expect(html).toContain('escalate-hitl');
    // 4 type 标签 + status tag
    expect(html).toContain('type="workflow_saas"');
    expect(html).toContain('type="workflow_dsh"');
    expect(html).toContain('type="tool_dsh"');
    expect(html).toContain('type="action_confirm"');
  });

  test('8. /admin/sessions shows M15 dsh session stats', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/sessions`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('dsh Session Postgres Backend');
    expect(html).toContain('dsh-session-create');
    expect(html).toContain('dsh-session-cleanup');
  });

  test('9. Sider nav 含 10 个入口 (overview + ontology + ops + governance)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    const html = await r.text();
    const navItems = html.match(/class="mp-nav-item[^"]*" href="([^"]+)"/g) ?? [];
    expect(navItems.length).toBeGreaterThanOrEqual(10);
  });

  test('10. /admin/ontology active nav 高亮 (active class)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/ontology`);
    const html = await r.text();
    expect(html).toContain('mp-nav-item active" href="/admin/ontology"');
  });

  test('11. dashboard ≥8 statistic cards', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    const html = await r.text();
    const cards = (html.match(/class="mp-stat-card"/g) ?? []).length;
    expect(cards).toBeGreaterThanOrEqual(8);
  });

  // Loop O: M10 mp-monitoring UI
  test('12. /admin/monitoring shows 5 subsystem health (Semi Tag colors)', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/monitoring`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    // 5 subsystem 都应出现
    expect(html).toContain('postgres');
    expect(html).toContain('pg_cron');
    expect(html).toContain('edge_functions');
    expect(html).toContain('realtime');
    expect(html).toContain('mp_sandbox_sidecar');
    // Overall status + summary
    expect(html).toContain('Overall');
    expect(html).toContain('Total Latency');
    // Semi Tag 颜色
    expect(html).toContain('mp-tag success');
    expect(html).toContain('mp-tag warning');
    expect(html).toContain('mp-tag danger');
  });

  test('13. /admin includes monitoring nav link', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/`);
    const html = await r.text();
    expect(html).toContain('/admin/monitoring');
    expect(html).toContain('系统监控');
  });

  // Loop U: mp-runtime 监控
  test('14. /admin/runtime shows mp-runtime EF + dsh session stats', async ({ page }) => {
    const r = await page.request.get(`${ADMIN}/admin/runtime`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('mp-runtime 业务运行时');
    expect(html).toContain('dsh Session by Status');
    expect(html).toContain('mp-runtime-trigger');
    expect(html).toContain('mp-runtime-status');
    expect(html).toContain('mp-runtime-cancel');
  });
});