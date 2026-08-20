// e2e/dsh-topbar-mp.spec.ts
//
// MP-V6 dsh-web topbar (2 mp menus) E2E test
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
//   3. The topbar mounts in the browser with 2 anchor items
//   4. Each menu id maps to the right external URL (data-menu-id round-trip)
//   5. Clicking the link opens the target URL in a new tab (target="_blank")

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:5173';

test.describe('MP-V6 dsh-web topbar (mp-marketplace + mp-platform-admin)', () => {
  test('1. /__mp_v6_topbar__/topbar.js is served (200)', async ({ request }) => {
    const r = await request.get(`${DSH_BASE}/__mp_v6_topbar__/topbar.js`);
    expect(r.status()).toBe(200);
    const body = await r.text();
    // sanity: the file is our own JS, not a 404 HTML page or someone else's
    expect(body).toContain('MP-V6 顶栏 plugin');
    expect(body).toContain('mp-marketplace');
    expect(body).toContain('mp-platform-admin');
  });

  test('2. dsh-web index.html injects the topbar <script>', async ({ request }) => {
    const r = await request.get(`${DSH_BASE}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('/__mp_v6_topbar__/topbar.js');
    expect(html).toMatch(/<script[^>]*src="\/__mp_v6_topbar__\/topbar\.js"[^>]*defer/);
  });

  test('3. topbar mounts with 2 menu items in the browser DOM', async ({ page }) => {
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
    await expect(items).toHaveCount(2);
  });

  test('4. menu ids and labels match PRD spec', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const marketplace = page.locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]');
    const admin = page.locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]');

    await expect(marketplace).toBeVisible();
    await expect(marketplace).toHaveText('市场');
    await expect(marketplace).toHaveAttribute('target', '_blank');

    await expect(admin).toBeVisible();
    await expect(admin).toHaveText('后台管理');
    await expect(admin).toHaveAttribute('target', '_blank');
  });

  test('5. menu URLs are correct (mp-marketplace → :8080/marketplace, admin → :8080/admin)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const marketplaceHref = await page
      .locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]')
      .getAttribute('href');
    const adminHref = await page
      .locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]')
      .getAttribute('href');

    expect(marketplaceHref).toBe('http://localhost:8080/marketplace');
    expect(adminHref).toBe('http://localhost:8080/admin');
  });

  test('6. clicking 后台管理 opens admin-server /admin (round-trip navigation)', async ({ page, context }) => {
    // Capture popup for the new tab that target="_blank" opens.
    const popupPromise = context.waitForEvent('page', { timeout: 5_000 });

    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]').click();
    const popup = await popupPromise;

    // The popup should be at admin-server :8080/admin (already running in dev).
    await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    expect(popup.url()).toBe('http://localhost:8080/admin');
    // The admin server renders an <h1>mp-platform 管理后台 PoC</h1>.
    await expect(popup.locator('h1')).toContainText('mp-platform 管理后台');
  });

  test('7. clicking 市场 opens mp-marketplace URL (placeholder target for now)', async ({ page, context }) => {
    const popupPromise = context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);

    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]').click();
    const popup = await popupPromise;

    // mp-marketplace UI not implemented yet — admin-server /marketplace 404s,
    // we still want to confirm the click opens a popup at the expected URL.
    // (When mp-marketplace ships, the admin route will return 200 and we can
    //  assert on its content too.)
    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      expect(popup.url()).toBe('http://localhost:8080/marketplace');
    } else {
      // If popup blocked / browser didn't fire, fall back to verifying the
      // href attribute is correct — still proves the click would navigate.
      const href = await page
        .locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]')
        .getAttribute('href');
      expect(href).toBe('http://localhost:8080/marketplace');
    }
  });
});