import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);

// Find all elements that mention preset
const info = await page.evaluate(() => {
  // Find all elements in the agent preset area
  const result = {
    allButtons: [],
    allSelects: [],
    presetArea: '',
  };

  // Find buttons with preset names
  const buttons = Array.from(document.querySelectorAll('button'));
  result.allButtons = buttons.map(b => b.textContent?.trim() || '').filter(t => t.length > 0 && t.length < 50);

  // Find select elements
  const selects = Array.from(document.querySelectorAll('select, [role="combobox"], [role="listbox"]'));
  result.allSelects = selects.map(s => ({
    tag: s.tagName,
    value: (s).value || '',
    options: s.tagName === 'SELECT' ? Array.from(s.querySelectorAll('option')).map(o => o.textContent?.trim() || '') : []
  }));

  // Find all preset names in the document
  const allPresets = ['cordis', 'standard', 'code', 'mp-v6', 'support-triage',
                      'knowledge-curator', 'ontology-curator', 'code-reviewer',
                      'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
  const allText = document.body.innerText;
  result.found = allPresets.filter(p => allText.toLowerCase().includes(p));

  // Find the agent preset section text
  const presetArea = document.querySelector('[class*="preset"], [id*="preset"]');
  result.presetArea = presetArea ? presetArea.textContent?.slice(0, 500) : 'not found';

  return result;
});
console.log('Found presets:', info.found);
console.log('All buttons:', info.allButtons.slice(0, 30));
console.log('All selects:', info.allSelects);
console.log('Preset area:', info.presetArea);

await page.screenshot({ path: 'e2e-screenshots/11-preset-inspection.png', fullPage: true });
await browser.close();
