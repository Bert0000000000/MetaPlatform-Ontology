import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Click on settings / agent preset selector
const selector = await page.$('text=settings|设置|preset|preset 选择');
if (selector) {
  await selector.click();
  await page.waitForTimeout(2000);
}

// Look for preset list
const presets = await page.evaluate(() => {
  // Find all preset names
  const items = Array.from(document.querySelectorAll('button, [role="menuitem"], [class*="preset"], [data-preset]'));
  return items.map(i => i.textContent?.trim()).filter(t => t && t.length < 50).slice(0, 20);
});
console.log('Preset items found:', presets);

// Get full body text
const body = await page.evaluate(() => document.body.innerText);
const allPresets = ['cordis', 'standard', 'code', 'mp-v6', 'support-triage',
                    'knowledge-curator', 'ontology-curator', 'code-reviewer',
                    'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
console.log('Found in body:', allPresets.filter(p => body.toLowerCase().includes(p)));

await page.screenshot({ path: 'e2e-screenshots/09-mp-v6-preset-loaded.png' });
console.log('Screenshot: e2e-screenshots/09-mp-v6-preset-loaded.png');
await browser.close();
