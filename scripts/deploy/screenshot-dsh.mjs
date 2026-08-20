import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

console.log('Loading dsh-web...');
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});

// Wait for hydration (Cordis plugins need time)
await page.waitForTimeout(5000);

// 1. Homepage
await page.screenshot({ path: 'e2e-screenshots/01-homepage.png', fullPage: false });
console.log('Screenshot 1: homepage');

// 2. Inject admin token to show more UI
await page.evaluate(() => {
  // Check what __DSH_BOOT__ has
  return JSON.stringify({
    rev: window.__DSH_BOOT__?.rev,
    pluginCount: window.__DSH_BOOT__?.entries?.length,
    hasUI: !!document.querySelector('[class*="ui"], [class*="chat"]'),
  });
}).then(r => console.log('  dsh boot:', r));

// 3. Check boot manifest
const manifest = await page.evaluate(() => {
  const entries = window.__DSH_BOOT__?.entries ?? [];
  return {
    totalPlugins: entries.length,
    apiPlugins: entries.filter(e => e.id.includes('api')).length,
    uiPlugins: entries.filter(e => e.id.includes('ui')).length,
    presets: entries.filter(e => e.id.includes('preset')).length,
    sampleApi: entries.slice(0, 5).map(e => e.id),
    sampleUI: entries.filter(e => e.id.includes('ui')).slice(0, 5).map(e => e.id),
  };
});
console.log('  Cordis manifest:', JSON.stringify(manifest, null, 2));

// 4. Check DOM for key UI elements
const dom = await page.evaluate(() => {
  return {
    title: document.title,
    bodyText: document.body.innerText.slice(0, 500),
    hasTextarea: !!document.querySelector('textarea'),
    hasButton: !!document.querySelector('button'),
    buttonCount: document.querySelectorAll('button').length,
  };
});
console.log('  DOM:', JSON.stringify(dom, null, 2));

// 5. Try interaction - find the chat input
try {
  const textarea = await page.$('textarea');
  if (textarea) {
    console.log('  Found textarea, typing test message...');
    await textarea.fill('What are the 4 pillars of MetaPlatform-Ontology v6.0?');
    await page.screenshot({ path: 'e2e-screenshots/02-chat-input.png' });
    console.log('  Screenshot 2: chat input filled');
  }
} catch (e) {
  console.log('  textarea interaction failed:', e.message);
}

// 6. Full page screenshot
await page.screenshot({ path: 'e2e-screenshots/03-fullpage.png', fullPage: true });
console.log('Screenshot 3: full page');

await browser.close();
console.log('Done. Screenshots in e2e-screenshots/');
