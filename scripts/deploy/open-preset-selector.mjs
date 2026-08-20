import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Find and click the settings button
const settingsBtn = await page.locator('text=设置').first();
if (await settingsBtn.count() > 0) {
  console.log('Clicking 设置...');
  await settingsBtn.click();
  await page.waitForTimeout(2000);
}

// Look for preset selector in settings panel
const presetInfo = await page.evaluate(() => {
  // Find all preset names in any element
  const allText = document.body.innerText;
  const allPresets = ['cordis', 'standard', 'code', 'mp-v6', 'support-triage',
                      'knowledge-curator', 'ontology-curator', 'code-reviewer',
                      'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
  return {
    found: allPresets.filter(p => allText.toLowerCase().includes(p)),
    bodyExcerpt: allText.slice(0, 1500),
  };
});
console.log('Found in body:', presetInfo.found);
console.log('Body excerpt:', presetInfo.bodyExcerpt);

await page.screenshot({ path: 'e2e-screenshots/10-settings-open.png', fullPage: true });
console.log('Screenshot saved');

await browser.close();
