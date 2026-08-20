import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
console.log('Page loaded, title:', await page.title());

// Open settings → Agent 预设
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

await page.screenshot({ path: 'e2e-screenshots/18-preset-list-final.png', fullPage: true });

// Click on mp-v6 preset card
const mp6Card = page.locator('text=/^mp-v6$/').first();
if (await mp6Card.count() > 0) {
  console.log('Found mp-v6 card, clicking...');
  await mp6Card.click({ force: true });
  await page.waitForTimeout(1000);
}

// Try clicking apply button
const applyBtn = page.locator('button:has-text("应用"), button:has-text("选择为默认")').first();
if (await applyBtn.count() > 0) {
  console.log('Clicking apply...');
  await applyBtn.click({ force: true });
  await page.waitForTimeout(2000);
}

// Close settings
await page.locator('text=关闭').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2000);

// Send test message to mp-v6 master
const textarea = await page.$('textarea');
if (textarea) {
  await textarea.fill('List the 4 pillars of MetaPlatform.0, then analyze the orders table for me. Use sql.');
  console.log('Message sent, waiting 60s...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60000);
  await page.screenshot({ path: 'e2e-screenshots/19-mp-v6-llm-response.png', fullPage: true });
  
  const lastMsg = await page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll('[class*="message"], [class*="markdown"]'));
    return messages.slice(-1)[0]?.textContent?.trim().slice(0, 1500);
  });
  console.log('\n=== Last LLM message ===');
  console.log(lastMsg);
}

await browser.close();
