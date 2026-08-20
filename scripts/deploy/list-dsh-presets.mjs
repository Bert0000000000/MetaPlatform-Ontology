import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
const data = await page.evaluate(() => {
  const boot = window.__DSH_BOOT__;
  return {
    rev: boot?.rev,
    pluginCount: boot?.entries?.length,
    mpV6: boot?.entries?.filter(e => e.id.includes('agent-preset') || e.id.includes('mp-v6') || ['support-triage', 'knowledge-curator', 'ontology-curator', 'code-reviewer', 'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'].some(p => e.id.includes(p))).map(e => e.id),
  };
});
console.log('Boot manifest:', JSON.stringify(data, null, 2));
const allText = await page.evaluate(() => document.body.innerText);
const presets = ['support-triage', 'knowledge-curator', 'ontology-curator', 'code-reviewer', 'data-analyst', 'contract-drafter', 'hitl-orchestrator', 'dashboard-curator'];
const found = presets.filter(p => allText.toLowerCase().includes(p));
console.log('\nFound in UI text:', found);
await page.screenshot({ path: 'e2e-screenshots/07-dsh-presets-final.png' });
await browser.close();
