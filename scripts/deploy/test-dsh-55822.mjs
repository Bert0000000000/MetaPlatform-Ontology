import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:55822', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings → Agent 预设
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

// Screenshot the preset list (with descriptions now)
await page.screenshot({ path: 'e2e-screenshots/15-preset-list-with-desc.png', fullPage: true });

// Find the apply button for the mp-v6 preset (last in the list)
// dsh uses "应用" or "Apply" or similar to set as default
const applyButtons = await page.locator('button:has-text("应用"), button:has-text("选择"), button:has-text("Apply"), button:has-text("Select")').all();
console.log('Apply buttons found:', applyButtons.length);

// Click on mp-v6 preset card (use locator that matches the name)
const mp6Card = page.locator('text=/^mp-v6$/').first();
if (await mp6Card.count() > 0) {
  console.log('Clicking on mp-v6 card...');
  await mp6Card.click({ force: true });
  await page.waitForTimeout(2000);
}

// Try clicking any "应用" (apply) or "选择为默认" button
for (const btn of applyButtons) {
  try {
    await btn.click({ force: true, timeout: 1000 });
    console.log('Clicked an apply button');
  } catch (e) {}
}
await page.waitForTimeout(2000);

// Close settings
await page.locator('text=关闭').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2000);

// Start new session
await page.locator('text=新会话').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2000);

// Send test message
const textarea = await page.$('textarea');
if (textarea) {
  await textarea.fill('Tell me the 4 pillars of MetaPlatform.0, then analyze the orders table for me.');
  console.log('Message typed, sending...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);  // first 5s for LLM to start
  await page.screenshot({ path: 'e2e-screenshots/16-dsh-thinking.png', fullPage: false });
  console.log('Waiting 60s for response...');
  await page.waitForTimeout(60000);
  await page.screenshot({ path: 'e2e-screenshots/17-dsh-response.png', fullPage: true });
  console.log('Final screenshot saved');
}

await browser.close();
