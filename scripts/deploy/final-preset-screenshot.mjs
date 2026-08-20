import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings → Agent 预设
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

await page.screenshot({ path: 'e2e-screenshots/13-mp-v6-presets-loaded.png', fullPage: true });
console.log('Screenshot: e2e-screenshots/13-mp-v6-presets-loaded.png');

// Extract preset names + descriptions
const presets = await page.evaluate(() => {
  const all = document.body.innerText;
  const allPresets = ['cordis', 'standard', 'code', 'minimal', 'mp-v6', 'support-triage',
                      'knowledge-curator', 'ontology-curator', 'code-reviewer',
                      'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
  return allPresets.filter(p => all.toLowerCase().includes(p));
});
console.log('\n=== Presets available in dsh-web (http://127.0.0.1:5173) ===');
presets.forEach((p, i) => console.log(`  ${i+1}. ${p}`));

await browser.close();
