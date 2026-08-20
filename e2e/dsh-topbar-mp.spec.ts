// e2e/dsh-topbar-mp.spec.ts
//
// MetaPlatform dsh-web topbar (4 menus: 云市场 + 应用中心 + Ontology 本体平台 + AI 助手) E2E test
//
// Run prerequisites:
//   1. dsh-web is up: DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh
//   2. admin-server is up: node scripts/dev/admin-server.mjs  (port 8080)
//   3. DSH_BASE_URL env var or default http://127.0.0.1:5173
//
// Run: DSH_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=dsh-web-ui -g "topbar"
//
// Verifies:
//   1. The /__mp_v6_topbar__/topbar.js bundle is served by dsh-web (200)
//   2. dsh-web index.html injects the <script defer src=...> tag
//   3. The topbar mounts in the browser with 4 anchor items
//   4. Each menu id maps to the right label (data-menu-id round-trip)
//   5. AI 助手 dispatches CustomEvent('dsh:open-chat') when clicked

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:5173';

test.describe('MetaPlatform dsh-web topbar (云市场 + 应用中心 + Ontology 本体平台 + AI 助手)', () => {
  test('1. /__mp_v6_topbar__/topbar.js is served (200)', async ({ request }) => {
    const r = await request.get(`${DSH_BASE}/__mp_v6_topbar__/topbar.js`);
    expect(r.status()).toBe(200);
    const body = await r.text();
    // sanity: the file is our own JS, not a 404 HTML page or someone else's
    expect(body).toContain('MetaPlatform 顶栏 plugin');
    expect(body).toContain('mp-marketplace');
    expect(body).toContain('mp-platform-admin');
    expect(body).toContain('mp-app-center');
    expect(body).toContain('mp-ai-assistant');
  });

  test('2. dsh-web index.html injects the topbar <script>', async ({ request }) => {
    const r = await request.get(`${DSH_BASE}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('/__mp_v6_topbar__/topbar.js');
    expect(html).toMatch(/<script[^>]*src="\/__mp_v6_topbar__\/topbar\.js"[^>]*defer/);
  });

  test('3. topbar mounts with 4 menu items in the browser DOM', async ({ page }) => {
    await page.goto(DSH_BASE);
    // Wait for our plugin to mount (vanilla DOM, fires from <script defer>).
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const topbar = page.locator('#mp-v6-topbar');
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveAttribute('data-mp-v6-plugin', 'topbar');

    // Position + z-index sanity (covers regression to position: static / hidden).
    const css = await topbar.evaluate((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, top: s.top, zIndex: s.zIndex, height: s.height };
    });
    expect(css.position).toBe('fixed');
    expect(css.top).toBe('0px');
    expect(parseInt(css.height, 10)).toBeGreaterThanOrEqual(40); // ~44px
    expect(parseInt(css.zIndex, 10)).toBeGreaterThan(1000);

    const items = topbar.locator('a[data-menu-id]');
    await expect(items).toHaveCount(4);
  });

  test('4. menu ids and labels match PRD spec (云市场 / 应用中心 / Ontology 本体平台 / AI 助手)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const marketplace = page.locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]');
    const appCenter = page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]');
    const admin = page.locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]');
    const aiAssistant = page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]');

    await expect(marketplace).toBeVisible();
    await expect(marketplace).toHaveText('云市场');

    await expect(appCenter).toBeVisible();
    await expect(appCenter).toHaveText('应用中心');

    await expect(admin).toBeVisible();
    await expect(admin).toHaveText('Ontology 本体平台');

    await expect(aiAssistant).toBeVisible();
    await expect(aiAssistant).toHaveText('AI 助手');
  });

  test('5. menu URLs are correct (云市场 → :8080/marketplace, 应用中心 → :8080/marketplace, admin → :8080/admin)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const marketplaceHref = await page
      .locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]')
      .getAttribute('href');
    const appCenterHref = await page
      .locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]')
      .getAttribute('href');
    const adminHref = await page
      .locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]')
      .getAttribute('href');

    expect(marketplaceHref).toBe('http://localhost:8080/marketplace');
    expect(appCenterHref).toBe('http://localhost:8080/marketplace');
    expect(adminHref).toBe('http://localhost:8080/admin');
  });

  test('6. clicking Ontology 本体平台 SPA-navigates to admin-server /admin (no popup)', async ({ page }) => {
    // New SPA-internal navigation: history.pushState on same-origin href.
    // No popup / new tab is opened. The same-tab URL updates in place.
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // The link uses same-tab SPA navigation (history.pushState + popstate).
    await page.locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]').click();
    await page.waitForTimeout(500);

    // After click, the same-tab pathname should be /admin (same origin path).
    const url = new URL(page.url());
    expect(url.pathname).toBe('/admin');
  });

  test('7. clicking AI 助手 dispatches CustomEvent dsh:open-chat', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // Listen for the custom event before clicking.
    const eventPromise = page.evaluate(
      () =>
        new Promise<{ source: string; menuId: string; label: string }>((resolve) => {
          window.addEventListener(
            'dsh:open-chat',
            (ev) => resolve((ev as CustomEvent).detail),
            { once: true },
          );
        }),
    );

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]').click();
    const detail = await eventPromise;

    expect(detail.source).toBe('mp-v6-topbar');
    expect(detail.menuId).toBe('mp-ai-assistant');
    expect(detail.label).toBe('AI 助手');
  });
});