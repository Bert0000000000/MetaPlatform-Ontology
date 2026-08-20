import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:55822', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(8000);
const body = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 800),
  hasIframe: !!document.querySelector('iframe'),
  title: document.title,
}));
console.log(JSON.stringify(body, null, 2));
await page.screenshot({ path: 'e2e-screenshots/check-55822.png', fullPage: false });
await browser.close();
