import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);

// Click "Agent 预设" button
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

// Look for preset list (might be a modal / dropdown / panel)
const presets = await page.evaluate(() => {
  // Look for any text content that has preset names
  const allText = document.body.innerText;
  const allPresets = ['cordis', 'standard', 'code', 'minimal', 'mp-v6', 'support-triage',
                      'knowledge-curator', 'ontology-curator', 'code-reviewer',
                      'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];

  // Also find any listbox / option elements
  const listboxes = Array.from(document.querySelectorAll('[role="listbox"], [role="option"], select, [data-preset]'));
  const listboxContent = listboxes.map(l => l.textContent?.slice(0, 200) || '');

  return {
    found: allPresets.filter(p => allText.toLowerCase().includes(p)),
    listboxCount: listboxes.length,
    listboxContent,
    bodyExcerpt: allText.slice(0, 2000),
  };
});
console.log('Presets found:', presets.found);
console.log('Listbox count:', presets.listboxCount);
console.log('Listbox content:', presets.listboxContent);
console.log('Body excerpt:', presets.bodyExcerpt);

await page.screenshot({ path: 'e2e-screenshots/12-preset-list.png', fullPage: true });
await browser.close();
