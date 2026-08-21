// e2e/ontology-debug.spec.ts
import { test } from '@playwright/test';

test('debug ontology', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => messages.push(`[console] ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => messages.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.url().includes('54321')) messages.push(`[response] ${r.status()} ${r.url()}`);
  });
  await page.goto('/admin/ontology');
  await page.waitForTimeout(5000);
  console.log('=== captured ===');
  for (const m of messages) console.log(m);
  console.log('=== body ===');
  const text = await page.locator('body').textContent();
  console.log(text?.slice(0, 1000));
  console.log('=== end ===');
});