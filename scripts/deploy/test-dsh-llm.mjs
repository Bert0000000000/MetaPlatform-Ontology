import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

console.log('=== 1. Load dsh-web ===');
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(5000);

// Check if DEEPSEEK_API_KEY is configured
const envCheck = await page.evaluate(() => {
  return {
    title: document.title,
    hasTextarea: !!document.querySelector('textarea'),
    buttonCount: document.querySelectorAll('button').length,
    // Try to find settings
    hasSettings: !!document.querySelector('[class*="setting"], [aria-label*="setting"]'),
  };
});
console.log('  Page state:', JSON.stringify(envCheck, null, 2));

// Look for model selector / settings
const modelText = await page.evaluate(() => {
  const all = document.body.innerText;
  return {
    hasDeepSeek: all.includes('DeepSeek'),
    hasModel: all.match(/DeepSeek-\S+/)?.[0] || null,
    hasMode: all.match(/(创造|预览|Standard|Full access)\S*/)?.[0] || null,
  };
});
console.log('  Model info:', JSON.stringify(modelText, null, 2));

// 2. Try sending a real message
console.log('\n=== 2. Type message in textarea ===');
const textarea = await page.$('textarea');
if (textarea) {
  const msg = 'List the 4 pillars of MetaPlatform in one line each.';
  await textarea.fill(msg);
  await page.screenshot({ path: 'e2e-screenshots/04-message-typed.png' });
  console.log('  Typed:', msg);

  // Find send button
  const sendBtn = await page.$('button[aria-label*="send"], button:has-text("发送"), button:has-text("Send")');
  if (sendBtn) {
    console.log('  Found send button, clicking...');
    await sendBtn.click();

    // Wait for response
    console.log('  Waiting 30s for LLM response...');
    await page.waitForTimeout(30000);
    await page.screenshot({ path: 'e2e-screenshots/05-llm-response.png', fullPage: true });

    // Get response text
    const lastMessages = await page.evaluate(() => {
      // Look for message content
      const messages = document.querySelectorAll('[class*="message"], [class*="markdown"]');
      return Array.from(messages).slice(-5).map(m => m.innerText.slice(0, 300));
    });
    console.log('  Recent messages:');
    lastMessages.forEach((m, i) => console.log(`    ${i+1}. ${m.replace(/\n/g, ' ')}`));
  } else {
    console.log('  No send button found');
  }
} else {
  console.log('  No textarea found');
}

await browser.close();
console.log('\nDone');
