// e2e/dsh-topbar-mp-internal.spec.ts
//
// MetaPlatform dsh-web topbar (4 mp menus, SPA-internal nav + tab switch feedback) E2E test
//
// Run prerequisites:
//   1. dsh-web is up: DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh
//   2. admin-server is up: node scripts/dev/admin-server.mjs  (port 8080)
//   3. DSH_BASE_URL env var or default http://127.0.0.1:5173
//
// Run: DSH_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=dsh-web-ui -g "internal"

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:5173';

// Map from topbar item.id -> the URL path it should activate on. Used to assert
// the right [data-active] state when we navigate.
const ACTIVE_ON = {
  'mp-ai-assistant':       '/',                  // chat is global, not a page route
  'mp-marketplace':        '/marketplace',
  'mp-app-center':         '/marketplace',        // same path as 云市场 for now
  'mp-platform-admin':     '/admin',
} as const;

test.describe('MetaPlatform dsh-web topbar — SPA-internal nav + tab feedback (4 menus)', () => {
  test('1. topbar mounts 4 menus in order: Ontology Copilot / 云市场 / 应用中心 / Ontology 本体平台', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const topbar = page.locator('#mp-v6-topbar');
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveAttribute('data-mp-v6-plugin', 'topbar');

    const items = topbar.locator('a[data-menu-id]');
    await expect(items).toHaveCount(4);

    const ids = await items.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).getAttribute('data-menu-id')),
    );
    expect(ids).toEqual([
      'mp-ai-assistant',
      'mp-marketplace',
      'mp-app-center',
      'mp-platform-admin',
    ]);

    // Per menu, the visible label must match the new copy.
    const expected = ['Ontology Copilot', '云市场', '应用中心', 'Ontology 本体平台'];
    const labels = await items.allInnerTexts();
    expect(labels).toEqual(expected);
  });

  test('2. menu items carry no target=_blank (no new tab on click)', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const links = page.locator('#mp-v6-topbar a[data-menu-id]');
    expect(await links.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      const t = await links.nth(i).getAttribute('target');
      expect(t).not.toBe('_blank');
    }

    // Behavioral: clicking AI 助手 must NOT open a new tab. (The chat item is
    // the only kind that does not navigate; clicking it only dispatches the
    // dsh:open-chat CustomEvent. The other 3 navigate the current tab.)
    const before = context.pages().length;
    await page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]').click();
    await page.waitForTimeout(300);
    expect(context.pages().length).toBe(before);
  });

  test('3. click 应用中心 → new tab opened (tab-switch UX, dsh kept open)', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const beforePages = context.pages().length;
    const beforeUrl = page.url();

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]').click();

    // Tab-switch UX: a new page opens in the context, dsh stays untouched.
    await page.waitForFunction(
      (n) => window.parent && window.parent !== window ? false : true && false && true, // noop
      beforePages,
      { timeout: 1_000 },
    ).catch(() => {});
    // Wait for popup detection
    await page.waitForTimeout(1_000);
    const newPageCount = context.pages().length;
    expect(newPageCount).toBe(beforePages + 1);

    // dsh must still be the active page (not navigated away).
    expect(page.url()).toBe(beforeUrl);

    // Visual: clicking the new tab's link sets [data-active="1"] on mp-app-center.
    // We can verify the *intent* by re-running the test on the new tab — but
    // for this PoC we just confirm the link element exists with the right id.
    await expect(page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]')).toHaveCount(1);
  });

  test('4. active state follows current path (one per path)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // On dsh root, the AI 助手 item is the only active match (its matchPath is '/').
    await page.waitForSelector(
      '#mp-v6-topbar a[data-menu-id="mp-ai-assistant"][data-active="1"]',
      { timeout: 3_000 },
    );

    // The 3 link items must NOT be active on the dsh root.
    for (const linkId of ['mp-marketplace', 'mp-app-center', 'mp-platform-admin']) {
      const activeCount = await page
        .locator(`#mp-v6-topbar a[data-menu-id="${linkId}"][data-active="1"]`)
        .count();
      expect(activeCount).toBe(0);
    }
  });

  test('5. active state clears when navigating to a non-menu path (simulated popstate)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );
    // Initially AI 助手 active.
    await page.waitForSelector(
      '#mp-v6-topbar a[data-menu-id="mp-ai-assistant"][data-active="1"]',
      { timeout: 3_000 },
    );

    // Simulate a dsh SPA-internal route change to a path that no menu matches
    // (e.g. a session view). The plugin must clear [data-active] everywhere.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/some/dsh/session/abc123');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    await page.waitForTimeout(100);

    const activeCount = await page.locator('#mp-v6-topbar a[data-active="1"]').count();
    expect(activeCount).toBe(0);
  });

  test('6. click AI 助手 → dsh:open-chat CustomEvent fires (no nav)', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // Tap into the event bus BEFORE clicking.
    await page.evaluate(() => {
      (window as unknown as { __mpV6OpenChatEvents: unknown[] }).__mpV6OpenChatEvents = [];
      window.addEventListener('dsh:open-chat', (e) => {
        const detail = (e as CustomEvent).detail ?? {};
        (window as unknown as { __mpV6OpenChatEvents: Array<{ menuId: string; label: string; source: string }> }).__mpV6OpenChatEvents.push({
          menuId: String(detail.menuId ?? ''),
          label: String(detail.label ?? ''),
          source: String(detail.source ?? ''),
        });
      });
    });

    const before = context.pages().length;
    await page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]').click();
    await page.waitForFunction(
      () => ((window as unknown as { __mpV6OpenChatEvents?: unknown[] }).__mpV6OpenChatEvents?.length ?? 0) > 0,
      { timeout: 5_000 },
    );

    const events = await page.evaluate(
      () => (window as unknown as { __mpV6OpenChatEvents: Array<{ menuId: string; label: string; source: string }> }).__mpV6OpenChatEvents,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].menuId).toBe('mp-ai-assistant');
    expect(events[0].label).toBe('Ontology Copilot');
    expect(events[0].source).toBe('mp-v6-topbar');
    expect(context.pages().length).toBe(before); // no new tab
  });
});
