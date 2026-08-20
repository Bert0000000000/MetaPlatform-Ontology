import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);

// Check dsh boot manifest for MP-v6 presets
const manifest = await page.evaluate(() => {
  const boot = window.__DSH_BOOT__;
  if (!boot) return null;
  return {
    rev: boot.rev,
    pluginCount: boot.entries?.length,
    // Look for our 8 MP-v6 presets in plugin IDs
    mpV6Presets: boot.entries?.filter(e =>
      e.id.includes('agent-preset') ||
      e.id.includes('mp-v6') ||
      ['support-triage', 'knowledge-curator', 'ontology-curator', 'code-reviewer',
       'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator']
        .some(p => e.id.includes(p))
    ).map(e => e.id),
  };
});
console.log('Boot manifest:', JSON.stringify(manifest, null, 2));

// Look for presets in dsh UI
const presetInfo = await page.evaluate(() => {
  // Try to find preset selector
  const allText = document.body.innerText;
  const mpV6Presets = ['support-triage', 'knowledge-curator', 'ontology-curator',
                       'code-reviewer', 'data-analyst', 'contract-drafter',
                       'hitl-orchestrator', 'dashboard-curator'];
  return {
    totalText: allText.length,
    foundPresets: mpV6Presets.filter(p => allText.toLowerCase().includes(p)),
    hasCordis: allText.toLowerCase().includes('cordis'),
    bodyExcerpt: allText.slice(0, 600),
  };
});
console.log('\nUI search:', JSON.stringify(presetInfo, null, 2));

await page.screenshot({ path: 'e2e-screenshots/06-dsh-with-presets.png' });
console.log('\nScreenshot: e2e-screenshots/06-dsh-with-presets.png');

await browser.close();
