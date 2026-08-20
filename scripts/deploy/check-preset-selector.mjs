import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Find agent preset selector - look for buttons / dropdowns that mention preset
const presetSelector = await page.evaluate(() => {
  // Look for any element that contains preset name
  const all = document.body.innerText;
  const presets = ['cordis', 'standard', 'code', 'minimal', 'support-triage',
                   'knowledge-curator', 'ontology-curator', 'code-reviewer',
                   'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
  return {
    bodyExcerpt: all.slice(0, 1000),
    found: presets.filter(p => all.toLowerCase().includes(p)),
  };
});
console.log(JSON.stringify(presetSelector, null, 2));

// Try to find and click the agent preset selector
try {
  // Look for any element with text containing 'preset' or any MP-v6 preset name
  const selector = await page.locator('text=/preset|agent|mp-v6/i').first();
  const text = await selector.textContent();
  console.log('Selector element:', text?.slice(0, 200));
} catch (e) {
  console.log('No preset selector found in DOM');
}

await page.screenshot({ path: 'e2e-screenshots/08-dsh-presets-page.png' });
console.log('Screenshot: e2e-screenshots/08-dsh-presets-page.png');
await browser.close();
