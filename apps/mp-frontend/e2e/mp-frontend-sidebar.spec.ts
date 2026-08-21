// e2e/mp-frontend-sidebar.spec.ts — mp-frontend Sider 二级菜单 + 4 一级模块子页验证
import { test, expect } from '@playwright/test';

test.describe('mp-frontend Sider 二级菜单 (4 一级模块)', () => {
  test('1. Sider 显示 4 个一级模块', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Ontology 本体平台').first()).toBeVisible();
    await expect(page.locator('text=云市场').first()).toBeVisible();
    await expect(page.locator('text=应用中心').first()).toBeVisible();
    await expect(page.locator('text=运营管理').first()).toBeVisible();
  });

  test('2. /admin/ontology/dashboard 加载并显示 4 stat', async ({ page }) => {
    await page.goto('/admin/ontology/dashboard');
    await expect(page.locator('text=Ontology Dashboard').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=ObjectType').first()).toBeVisible();
    await expect(page.locator('text=RelationType').first()).toBeVisible();
    await expect(page.locator('text=ActionType').first()).toBeVisible();
    await expect(page.locator('text=Generate').first()).toBeVisible();
  });

  test('3. /admin/ontology/objects 加载 ObjectType 表', async ({ page }) => {
    await page.goto('/admin/ontology/objects');
    await expect(page.locator('h3:has-text("ObjectType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    // 检查 customer/contract/order/product rid 出现
    const hasCustomer = await page.locator('text=customer').first().isVisible();
    const hasOrder = await page.locator('text=order').first().isVisible();
    expect(hasCustomer || hasOrder).toBeTruthy();
  });

  test('4. /admin/ontology/relations 加载 RelationType 表', async ({ page }) => {
    await page.goto('/admin/ontology/relations');
    await expect(page.locator('h3:has-text("RelationType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('5. /admin/ontology/actions 加载 ActionType 表', async ({ page }) => {
    await page.goto('/admin/ontology/actions');
    await expect(page.locator('h3:has-text("ActionType")').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('6. /admin/ontology/graph 渲染本体图谱 SVG', async ({ page }) => {
    await page.goto('/admin/ontology/graph');
    await expect(page.locator('text=本体图谱').first()).toBeVisible({ timeout: 10000 });
    // 等数据加载
    await page.waitForTimeout(2500);
    // 验证 SVG 存在 (data-testid)
    const svg = page.locator('[data-testid="ontology-graph-svg"]');
    await expect(svg).toBeVisible();
    // 验证至少 1 个节点 (rect = node). 在 dev DB 可能数据有限, 至少 1
    const nodes = page.locator('[data-testid="ontology-graph-svg"] rect');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);
  });

  test('7. /admin/ontology/kb 显示空状态 + 搜索框', async ({ page }) => {
    await page.goto('/admin/ontology/kb');
    await expect(page.locator('h3:has-text("知识库")').first()).toBeVisible({ timeout: 10000 });
    // 搜索框存在
    const searchInput = page.locator('input[placeholder*="title"]').first();
    await expect(searchInput).toBeVisible();
  });

  test('8. /admin/ontology/llm 加载并显示 generate 按钮', async ({ page }) => {
    await page.goto('/admin/ontology/llm');
    await expect(page.locator('h3:has-text("LLM 本体生成")').first()).toBeVisible({ timeout: 10000 });
    // 输入 + 按钮可见
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    const btn = page.locator('button:has-text("generate-ontology-proposal")');
    await expect(btn).toBeVisible();
  });

  test('9. /admin/marketplace/installs 加载', async ({ page }) => {
    await page.goto('/admin/marketplace/installs');
    await expect(page.locator('h3:has-text("我的安装")').first()).toBeVisible({ timeout: 10000 });
  });

  test('10. /admin/marketplace/publish 加载 form', async ({ page }) => {
    await page.goto('/admin/marketplace/publish');
    await expect(page.locator('h3:has-text("发布")').first()).toBeVisible({ timeout: 10000 });
    // 至少 3 个 input (slug/name/version)
    const inputs = page.locator('input');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThanOrEqual(3);
  });

  test('11. /admin/marketplace/search 加载', async ({ page }) => {
    await page.goto('/admin/marketplace/search');
    await expect(page.locator('h3:has-text("全文搜索")').first()).toBeVisible({ timeout: 10000 });
    // 搜索框
    const searchInput = page.locator('input[placeholder*="关键词"]').first();
    await expect(searchInput).toBeVisible();
  });

  test('12. /admin/dashboard 加载运营管理 Dashboard', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page.locator('h3:has-text("运营管理 Dashboard")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Tenants').first()).toBeVisible();
    await expect(page.locator('text=dsh Sessions').first()).toBeVisible();
  });

  test('13. 根路由 / 重定向到 /admin/dashboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/dashboard/);
  });

  test('14. 旧路由 /admin/ontology 重定向到 /admin/ontology/objects', async ({ page }) => {
    await page.goto('/admin/ontology');
    await page.waitForURL(/\/admin\/ontology\/objects/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/ontology\/objects/);
  });

  test('15. Ontology 本体平台 子菜单展开 (含 7 项)', async ({ page }) => {
    await page.goto('/admin/ontology/dashboard');
    // 默认展开 Ontology 本体平台 subnav
    await page.waitForTimeout(500);
    // 子项: Dashboard / ObjectType / RelationType / ActionType / 本体图谱 / 知识库 / LLM 生成
    await expect(page.locator('text=ObjectType').first()).toBeVisible();
    await expect(page.locator('text=RelationType').first()).toBeVisible();
    await expect(page.locator('text=ActionType').first()).toBeVisible();
    await expect(page.locator('text=本体图谱').first()).toBeVisible();
    await expect(page.locator('text=知识库').first()).toBeVisible();
    await expect(page.locator('text=LLM 生成').first()).toBeVisible();
  });

  test('16. 应用中心 子菜单展开 (frontend-obs + Sandbox)', async ({ page }) => {
    await page.goto('/admin/frontend-obs');
    await expect(page.locator('text=frontend-obs').first()).toBeVisible();
    await expect(page.locator('text=Sandbox').first()).toBeVisible();
  });

  test('17. 运营管理 子菜单展开 (5 项)', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page.locator('text=Runtime').first()).toBeVisible();
    await expect(page.locator('text=Monitoring').first()).toBeVisible();
    await expect(page.locator('text=Audit').first()).toBeVisible();
    await expect(page.locator('text=Tenants').first()).toBeVisible();
  });

  test('18. 点击 Sider 子项能跳转', async ({ page }) => {
    await page.goto('/admin/ontology/dashboard');
    await page.waitForTimeout(500);
    // 点击 ObjectType 子项
    await page.locator('text=ObjectType').first().click();
    await page.waitForURL(/\/admin\/ontology\/objects/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/ontology\/objects/);
  });

  test('19. 无未捕获 pageerror (Sidebar + 新页面)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/ontology/dashboard');
    await page.waitForTimeout(2000);
    await page.goto('/admin/ontology/graph');
    await page.waitForTimeout(2000);
    await page.goto('/admin/ontology/llm');
    await page.waitForTimeout(2000);
    const fatal = errors.filter((m) => !m.includes('Download the React DevTools'));
    expect(fatal, `unexpected pageerrors: ${fatal.join(' | ')}`).toHaveLength(0);
  });
});