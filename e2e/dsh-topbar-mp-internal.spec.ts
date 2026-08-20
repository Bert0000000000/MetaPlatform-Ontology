// e2e/dsh-topbar-mp-internal.spec.ts
//
// MetaPlatform dsh-web topbar (4 mp menus, SPA-internal nav) E2E test
//
// Run prerequisites:
//   1. dsh-web is up: DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh
//   2. admin-server is up: node scripts/dev/admin-server.mjs  (port 8080)
//   3. DSH_BASE_URL env var or default http://127.0.0.1:5173
//
// Run: DSH_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=dsh-web-ui -g "internal"
//
// Verifies the MetaPlatform topbar adds 4 menu items and navigates WITHOUT opening new
// tabs (replaces target="_blank" with same-tab navigation). The "AI 助手"
// menu dispatches a 'dsh:open-chat' CustomEvent so any host code (chat panel,
// sidebar toggle, etc.) can react. The 3 link menus navigate the current tab
// to /marketplace or /admin via SPA-internal pushState (same-origin) or
// window.location.assign (cross-origin: 5173 → 8080) — both stay in one tab.

import { test, expect } from '@playwright/test';

const DSH_BASE = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:5173';

test.describe('MetaPlatform dsh-web topbar — SPA-internal nav (4 menus)', () => {
  test('1. topbar mounts with 4 menu items: 云市场 / 应用中心 / Ontology 本体平台 / AI 助手', async ({ page }) => {
    await page.goto(DSH_BASE);
    // Wait for our plugin to mount (vanilla DOM, fires from <script defer>).
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const topbar = page.locator('#mp-v6-topbar');
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveAttribute('data-mp-v6-plugin', 'topbar');

    const items = topbar.locator('a[data-menu-id]');
    await expect(items).toHaveCount(4);

    // All four ids present, in the canonical render order.
    const ids = await items.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).getAttribute('data-menu-id'))
    );
    expect(ids).toEqual([
      'mp-marketplace',
      'mp-app-center',
      'mp-platform-admin',
      'mp-ai-assistant',
    ]);
  });

  test('2. menu labels match the Chinese PRD spec', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    await expect(
      page.locator('#mp-v6-topbar a[data-menu-id="mp-marketplace"]'),
    ).toHaveText('云市场');
    await expect(
      page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]'),
    ).toHaveText('应用中心');
    await expect(
      page.locator('#mp-v6-topbar a[data-menu-id="mp-platform-admin"]'),
    ).toHaveText('Ontology 本体平台');
    await expect(
      page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]'),
    ).toHaveText('AI 助手');
  });

  test('3. clicking menu links does NOT open a new tab (no target=_blank)', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // a) Attribute check: nothing in the topbar carries target="_blank".
    const allLinks = page.locator('#mp-v6-topbar a[data-menu-id]');
    const count = await allLinks.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const target = await allLinks.nth(i).getAttribute('target');
      expect(target).not.toBe('_blank');
    }

    // b) Behavioral check: clicking AI 助手 (which does NOT navigate away)
    //    must not create a new Page in the context.
    const before = context.pages().length;

    // Suppress the side-effect click on dsh's known chat button (best-effort in
    // the plugin): we only care that no popup is opened by the topbar itself.
    const chatLink = page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]');
    await chatLink.click();
    await page.waitForTimeout(300);

    const after = context.pages().length;
    expect(after).toBe(before);
  });

  test('4. click 应用中心 → URL changes to /marketplace (SPA-internal, same tab)', async ({ page, context }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    const beforePages = context.pages().length;
    const initialUrl = page.url();

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-app-center"]').click();

    // URL must change to include /marketplace, in the same tab.
    await page.waitForFunction(
      (initial: string) => {
        const cur = window.location.href;
        return cur !== initial && cur.includes('/marketplace');
      },
      initialUrl,
      { timeout: 5_000 },
    );

    expect(page.url()).toContain('/marketplace');

    // And critically: no new tab was opened by the click.
    expect(context.pages().length).toBe(beforePages);
  });

  test('5. click AI 助手 → dsh:open-chat CustomEvent fires (chat panel trigger)', async ({ page }) => {
    await page.goto(DSH_BASE);
    await page.waitForFunction(
      () => document.body.getAttribute('data-mp-v6-topbar-mounted') === '1',
      { timeout: 10_000 },
    );

    // Install a listener BEFORE the click so we don't race the dispatch.
    await page.evaluate(() => {
      (window as unknown as { __mpV6OpenChatEvents: unknown[] }).__mpV6OpenChatEvents = [];
      window.addEventListener('dsh:open-chat', (e) => {
        const detail = (e as CustomEvent).detail ?? {};
        (window as unknown as {
          __mpV6OpenChatEvents: Array<{ menuId: string; label: string; source: string }>;
        }).__mpV6OpenChatEvents.push({
          menuId: String(detail.menuId ?? ''),
          label: String(detail.label ?? ''),
          source: String(detail.source ?? ''),
        });
      });
    });

    await page.locator('#mp-v6-topbar a[data-menu-id="mp-ai-assistant"]').click();

    // Wait for the event to fire (dispatch is synchronous in the click handler).
    await page.waitForFunction(
      () =>
        ((window as unknown as { __mpV6OpenChatEvents?: unknown[] }).__mpV6OpenChatEvents?.length ?? 0) > 0,
      { timeout: 5_000 },
    );

    const events = await page.evaluate(
      () =>
        (window as unknown as {
          __mpV6OpenChatEvents: Array<{ menuId: string; label: string; source: string }>;
        }).__mpV6OpenChatEvents,
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].menuId).toBe('mp-ai-assistant');
    expect(events[0].label).toBe('AI 助手');
    expect(events[0].source).toBe('mp-v6-topbar');
  });
});