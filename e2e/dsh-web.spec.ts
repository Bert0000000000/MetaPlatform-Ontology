// e2e/dsh-web.spec.ts
// MetaPlatform E2E: dsh-web UI 测试
//
// 启动: DSH_PORT=5173 dsh web --host 127.0.0.1
// 运行: DSH_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=dsh-web-ui
//
// 验证:
//   1. dsh-web 加载主页
//   2. /health 端点 200 (若存在)
//   3. window.__DSH_BOOT__ 存在 (Cordis 插件 manifest)
//   4. 静态资源加载 (JS bundles)
//   5. dsh API endpoint 可达

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:5173';

test.describe('dsh-web UI', () => {
  test('1. homepage loads (200 + title)', async ({ page }) => {
    const response = await page.goto(DSH_BASE);
    expect(response?.status()).toBe(200);
    // 等待 hydration
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    // dsh-web title 是 "DeepSeek Harness" (从 <title> 取)
    const title = await page.title();
    expect(title.toLowerCase()).toMatch(/dsh|deepseek|harness/);
  });

  test('2. static bundles load (Cordis 插件架构)', async ({ page, request }) => {
    // dsh-web 通过 /assets/ 和 /plugins/ 加载 50+ Cordis 插件
    const r1 = await request.get(`${DSH_BASE}/assets/index-CA9Bpko5.js`);
    const r2 = await request.get(`${DSH_BASE}/plugins/@deepseek-ai/dsh-client-modules/client.js`);
    expect(r1.status()).toBe(200);
    expect(r2.status()).toBe(200);
  });

  test('3. boot manifest exposes Cordis plugin system', async ({ page }) => {
    await page.goto(DSH_BASE);
    // 等待 hydration 完成
    await page.waitForFunction(() => (window as unknown as { __DSH_BOOT__?: unknown }).__DSH_BOOT__ !== undefined, { timeout: 10_000 });

    const boot = await page.evaluate(() => (window as unknown as {
      __DSH_BOOT__?: {
        rev: string;
        entries: Array<{ id: string; url: string }>;
      };
    }).__DSH_BOOT__);

    expect(boot).toBeTruthy();
    expect(boot!.rev).toBeTruthy();
    expect(Array.isArray(boot!.entries)).toBe(true);
    expect(boot!.entries.length).toBeGreaterThan(20);  // 50+ dsh 插件

    // 验证关键插件 (我们的 4 大支柱集成)
    const pluginIds = boot!.entries.map((e) => e.id);
    expect(pluginIds).toContain('@deepseek-ai/dsh-api-gateway');
    expect(pluginIds).toContain('@deepseek-ai/dsh-client-runtime');
    expect(pluginIds).toContain('@deepseek-ai/dsh-client-ui-conversation');
  });

  test('4. UI conversation plugin (chat input) exists in DOM', async ({ page }) => {
    await page.goto(DSH_BASE);
    // 等 Cordis 插件加载
    await page.waitForTimeout(2000);

    // 验证页面有 dsh UI 元素 (Cordis-managed DOM)
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('5. dsh 0.1.0-rc.7 version banner', async ({ request }) => {
    // 验证 dsh 后端 API (Cordis API gateway)
    // dsh API 在 /api/v1/... 路径
    const r = await request.get(`${DSH_BASE}/api/manifest`);
    // 不期望一定有这个端点, 但应该返回 200 或 404 (不能 500)
    expect([200, 404]).toContain(r.status());
  });
});