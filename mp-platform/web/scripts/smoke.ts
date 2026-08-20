// scripts/smoke.ts — 1-shot check via chromium
import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('[console]', msg.type(), msg.text()); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  // 1. login page
  await page.goto('http://127.0.0.1:5183/login');
  await page.waitForTimeout(1500);
  // fill and submit
  const ADMIN_EMAIL = `e2e-admin-${Date.now()}@mp.local`;
  const ADMIN_PASSWORD = 'Admin123!';

  // Skip the actual login for now — we'll just auth the localStorage and reload tenants
  await page.evaluate(({ token, userJson }) => {
    localStorage.setItem('mp.admin.jwt', token);
    localStorage.setItem('mp.admin.user', userJson);
  }, {
    token: 'eyJ.eyJzdWIiOiJ0ZXN0In0.test',
    userJson: JSON.stringify({ id: 'test', email: 'admin@mp.local', role: 'admin', tenantId: 'test' }),
  });

  await page.goto('http://127.0.0.1:5183/tenants');
  await page.waitForTimeout(2000);
  const hasTenantsPage = await page.locator('[data-testid="mp-tenants-page"]').count();
  const hasTenantsTable = await page.locator('[data-testid="mp-tenants-table"]').count();
  const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 300);
  console.log('---TENANTS_PAGE testid:', hasTenantsPage);
  console.log('---TENANTS_TABLE testid:', hasTenantsTable);
  console.log('---BODY TEXT:', bodyText);

  await page.goto('http://127.0.0.1:5183/audit');
  await page.waitForTimeout(2000);
  const hasAuditPage = await page.locator('[data-testid="mp-audit-page"]').count();
  const bodyText2 = (await page.evaluate(() => document.body.innerText)).slice(0, 300);
  console.log('---AUDIT_PAGE testid:', hasAuditPage);
  console.log('---BODY TEXT AUDIT:', bodyText2);

  await browser.close();
})();


