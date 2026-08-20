import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings → Agent 预设
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

// Find ALL clickable elements (input, button, [role=button])
const clickables = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('input, button, [role="button"], [role="radio"], [role="checkbox"]'));
  return els.map(e => ({
    tag: e.tagName,
    type: e.type || '',
    role: e.getAttribute('role') || '',
    name: e.name || '',
    text: (e.textContent || '').trim().slice(0, 50),
    value: e.value || '',
    classes: e.className?.slice(0, 30) || '',
    enabled: !e.disabled,
  })).filter(e => e.text.toLowerCase().includes('mp-v6') || e.value === 'mp-v6' || e.name === 'mp-v6' || e.text.toLowerCase().includes('应用') || e.text.toLowerCase().includes('apply')).slice(0, 10);
});
console.log('MP-v6 related elements:', JSON.stringify(clickables, null, 2));

// Try clicking the radio input with value 'mp-v6'
const radioMp6 = await page.$('input[value="mp-v6"], input[type="radio"][name*="mp-v6"]');
if (radioMp6) {
  console.log('Found mp-v6 radio, clicking...');
  await radioMp6.click({ force: true });
  await page.waitForTimeout(1000);
}

// Click apply button (might be 应用 / Apply)
const applyBtn = await page.locator('button:has-text("应用"), button:has-text("Apply"), button:has-text("应用")').first();
if (await applyBtn.count() > 0) {
  console.log('Clicking apply button...');
  await applyBtn.click();
  await page.waitForTimeout(2000);
}

await page.screenshot({ path: 'e2e-screenshots/webui-05-mp-v6-applied.png', fullPage: true });

// Close settings
await page.locator('text=关闭').first().click().catch(() => {});
await page.waitForTimeout(2000);

// Now send a test message
const textarea = await page.$('textarea');
if (textarea) {
  await textarea.fill('List the 4 pillars of MP-V6.0 in one line each.');
  await page.screenshot({ path: 'e2e-screenshots/webui-06-typed.png', fullPage: false });

  // Try sending
  const sendBtn = await page.$('button[aria-label*="send"], button:has-text("发送")');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await textarea.press('Enter');
  }

  console.log('Waiting 60s for mp-v6 agent response...');
  await page.waitForTimeout(60000);
  await page.screenshot({ path: 'e2e-screenshots/webui-07-response.png', fullPage: true });

  const response = await page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll('[class*="message"], [class*="markdown"]'));
    return messages.slice(-3).map(m => m.textContent?.trim().slice(0, 1500));
  });
  console.log('\n=== LLM Response (last 3 messages) ===');
  response.forEach((m, i) => {
    if (m) console.log(`\n[${i+1}] ${m}`);
  });
}

await browser.close();
