import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,  // Will display via screenshot output
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

console.log('=== 1. Open dsh-web ===');
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

console.log('  Title:', await page.title());
console.log('  URL:', page.url());

// Screenshot homepage
await page.screenshot({ path: 'e2e-screenshots/webui-01-homepage.png', fullPage: false });
console.log('  Screenshot: e2e-screenshots/webui-01-homepage.png');

console.log('\n=== 2. Open Settings → Agent 预设 ===');
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

await page.screenshot({ path: 'e2e-screenshots/webui-02-preset-list.png', fullPage: true });
console.log('  Screenshot: e2e-screenshots/webui-02-preset-list.png');

console.log('\n=== 3. Select mp-v6 preset (master) ===');
// Click on mp-v6 preset
const mp6Btn = page.locator('text=/^mp-v6$/').first();
if (await mp6Btn.count() > 0) {
  await mp6Btn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e-screenshots/webui-03-mp-v6-selected.png', fullPage: false });
  console.log('  Screenshot: e2e-screenshots/webui-03-mp-v6-selected.png');
} else {
  console.log('  mp-v6 preset button not found');
}

console.log('\n=== 4. Close settings + start new chat ===');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.locator('text=关闭').first().click().catch(() => {});
await page.waitForTimeout(1000);

console.log('\n=== 5. Send test message to mp-v6 agent ===');
const textarea = await page.$('textarea');
if (textarea) {
  const prompt = 'List the 4 pillars of MP-V6.0 in one line each, and tell me which one is most critical for tenant isolation.';
  await textarea.fill(prompt);
  console.log('  Typed:', prompt);
  await page.screenshot({ path: 'e2e-screenshots/webui-04-message-typed.png', fullPage: false });

  // Try sending via Enter or click
  const sendBtn = await page.$('button[aria-label*="send"], button:has-text("发送")');
  if (sendBtn) {
    await sendBtn.click();
    console.log('  Clicked send button, waiting 60s for LLM...');
  } else {
    await textarea.press('Enter');
    console.log('  Pressed Enter, waiting 60s for LLM...');
  }
  await page.waitForTimeout(60000);
  await page.screenshot({ path: 'e2e-screenshots/webui-05-llm-response.png', fullPage: true });
  console.log('  Screenshot: e2e-screenshots/webui-05-llm-response.png');

  // Get the LLM response text
  const response = await page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll('[class*="message"], [class*="markdown"]'));
    return messages.slice(-3).map(m => m.textContent?.trim().slice(0, 800));
  });
  console.log('\n=== 6. LLM Response (last 3 messages) ===');
  response.forEach((m, i) => {
    if (m) {
      console.log(`\n[${response.length - 3 + i + 1}] ${m}`);
    }
  });
}

await browser.close();
console.log('\n=== Done ===');
