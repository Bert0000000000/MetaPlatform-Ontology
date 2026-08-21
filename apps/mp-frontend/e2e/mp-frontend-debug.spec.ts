// e2e/mp-frontend-debug.spec.ts — debug page errors
import { test, expect } from '@playwright/test';

test('debug: console + pageerror', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(`[console] ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  await page.goto('/');
  await page.waitForTimeout(2000);
  console.log('=== captured ===');
  for (const m of messages) console.log(m);
  console.log('=== end ===');
});