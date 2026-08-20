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

  test('3. click 应用中心 → URL becomes /marketplace, same tab, [data-active] set', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const before = context.pages().length;
    const initial = page.url();

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]').click();

    // SPA-internal nav: same tab, URL must change.
    await page.waitForFunction(
      (init: string) => window.location.href !== init && window.location.href.includes('/marketplace'),
      initial,
      { timeout: 5_000 },
    );
    expect(page.url()).toContain('/marketplace');
    expect(context.pages().length).toBe(before);

    // Tab-switching feedback: the clicked item gets [data-active="1"] and
    // the previous item is cleared. Only one item is active at a time.
    await page.waitForSelector(
      '#mp-v6-topbar a[data-menu-id="mp-app-center"][data-active="1"]',
      { timeout: 3_000 },
    );
    const activeIds = await page.locator('#mp-v6-topbar a[data-active="1"]').evaluateAll(
      (els) => els.map((el) => (el as HTMLElement).getAttribute('data-menu-id')),
    );
    expect(activeIds).toEqual(['mp-app-center']);

    // Visual: the active item carries a different background colour than the
    // others (CSS `.mp-v6-active` class). The non-active items do not.
    const activeColor = await page.evaluate(() => {
      const a = document.querySelector('#mp-v6-topbar a[data-menu-id="mp-app-center"]') as HTMLElement;
      const p = document.querySelector('#mp-v6-topbar a[data-menu-id="mp-marketplace"]') as HTMLElement;
      return { active: getComputedStyle(a).backgroundColor, plain: getComputedStyle(p).backgroundColor };
    });
    expect(activeColor.active).not.toBe(activeColor.plain);
  });

  test('4. active state follows current path (click each link, verify [data-active] matches)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    for (const [id, path] of Object.entries(ACTIVE_ON)) {
      if (id === 'mp-ai-assistant') continue; // chat is a CustomEvent, not navigation

      // Click the menu item. SPA-internal nav updates the URL.
      await page.locator(`#mp-v6-topbar a[data-menu-id="${id}"]`).click();
      await page.waitForFunction(
        (expected: string) => window.location.pathname.startsWith(expected),
        path,
        { timeout: 5_000 },
      );

      // The clicked item must be marked active; no other item may be active.
      const activeCount = await page.locator('#mp-v6-topbar a[data-active="1"]').count();
      expect(activeCount).toBe(1);
      const activeId = await page.locator('#mp-v6-topbar a[data-active="1"]').getAttribute('data-menu-id');
      expect(activeId).toBe(id);
    }
  });

  test('5. active state clears when path does not match any menu (home view)', async ({ page }) => {
    // Start on a known active path, then navigate (programmatically) to a
    // non-menu path. The plugin should drop [data-active] from all items.
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );
    await page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]').click();
    await page.waitForSelector(
      '#mp-v6-topbar a[data-menu-id="mp-app-center"][data-active="1"]',
      { timeout: 3_000 },
    );

    // Simulate navigation away (dsh internal route change).
    await page.evaluate(() => window.history.pushState({}, '', '/some/other/page'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate', {})));
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
