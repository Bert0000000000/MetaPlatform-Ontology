// e2e/dsh-web.spec.ts
// MP-V6 E2E: dsh-web UI 测试 (需要本机 dsh-web 跑起来)
//
// 启动: cd vendor/deepseek-harness && pnpm install && DSH_PORT=3080 pnpm dsh web
// 运行: pnpm exec playwright test dsh-web
//
// 验证:
//   1. dsh-web 加载主页
//   2. DSH_BOOT manifest 包含 LLM provider + sandbox
//   3. /health 端点 200
//   4. Realtime WS 连接
//   5. 数字员工 preset 可见 (support-triage / knowledge-curator / ontology-curator)

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://localhost:3080';

test.describe('dsh-web UI', () => {
  test('1. homepage loads (200 + title)', async ({ page }) => {
    const response = await page.goto(DSH_BASE);
    expect(response?.status()).toBe(200);
    // 等待 hydration
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    // dsh-web title 在 manifest
    const title = await page.title();
    expect(title.toLowerCase()).toMatch(/dsh|deepseek/);
  });

  test('2. /health endpoint returns OK', async ({ request }) => {
    const r = await request.get(`${DSH_BASE}/health`);
    expect(r.status()).toBe(200);
  });

  test('3. boot manifest exposes LLM + sandbox', async ({ page }) => {
    await page.goto(DSH_BASE);
    // dsh-web 把 __DSH_BOOT__ 注入 window
    const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__?: unknown }).__DSH_BOOT__);
    expect(boot).toBeTruthy();
    const bootObj = boot as { llm?: unknown; sandbox?: unknown; presets?: string[] };
    expect(bootObj.llm).toBeTruthy();
    expect(bootObj.sandbox).toBeTruthy();
    expect(bootObj.presets).toBeDefined();
    expect(bootObj.presets?.length).toBeGreaterThan(0);
  });

  test('4. presets include our 3 dsh presets (support-triage / knowledge-curator / ontology-curator)', async ({ page }) => {
    await page.goto(DSH_BASE);
    const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__?: { presets: { rid: string }[] } }).__DSH_BOOT__);
    const rids = boot?.presets?.map((p) => p.rid) ?? [];
    expect(rids).toContain('support-triage');
    expect(rids).toContain('knowledge-curator');
    expect(rids).toContain('ontology-curator');
  });

  test('5. Realtime WebSocket connects to Supabase', async ({ page }) => {
    let wsConnected = false;
    page.on('websocket', (ws) => {
      if (ws.url().includes('54321') || ws.url().includes('realtime')) {
        wsConnected = true;
      }
    });
    await page.goto(DSH_BASE);
    await page.waitForTimeout(3000);
    expect(wsConnected).toBeTruthy();
  });
});