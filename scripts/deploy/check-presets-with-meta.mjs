import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Open settings
await page.locator('text=设置').first().click();
await page.waitForTimeout(2000);
await page.locator('text=Agent 预设').first().click();
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const allText = document.body.innerText;
  // Find preset names + descriptions (look for card patterns)
  const cards = Array.from(document.querySelectorAll('[class*="card"], [class*="preset"]'));
  const found = [];
  for (const p of ['mp-v6', 'support-triage', 'knowledge-curator', 'ontology-curator',
                     'code-reviewer', 'data-analyst', 'contract-drafter',
                     'hitl-orchestrator', 'dashboard-curator']) {
    if (allText.toLowerCase().includes(p)) {
      // Get surrounding text (next 200 chars after preset name)
      const idx = allText.toLowerCase().indexOf(p);
      const snippet = allText.slice(idx, idx + 200);
      found.push({ name: p, snippet });
    }
  }
  return { found, bodyExcerpt: allText.slice(0, 3000) };
});
console.log('Found presets in UI:');
for (const f of info.found) {
  console.log(`\n[${f.name}]`);
  console.log(`  ${f.snippet.replace(/\n/g, ' ').slice(0, 200)}`);
}
await page.screenshot({ path: 'e2e-screenshots/14-mp-v6-with-meta.png', fullPage: true });
await browser.close();
