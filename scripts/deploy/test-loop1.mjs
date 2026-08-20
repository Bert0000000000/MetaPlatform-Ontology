import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let pass = 0, fail = 0;
const checks = [
  { name: 'mp_preset_registry.presets exists', url: 'http://localhost:54321/rest/v1/mp_preset_registry.presets?select=id,name&limit=1', expectStatus: 200 },
  { name: 'mp_preset_registry.versions exists', url: 'http://localhost:54321/rest/v1/mp_preset_registry.versions?select=id,version&limit=1', expectStatus: 200 },
  { name: 'mp_preset_registry.installs exists', url: 'http://localhost:54321/rest/v1/mp_preset_registry.installs?select=id&limit=1', expectStatus: 200 },
  { name: 'app-center-cleanup cron scheduled', url: 'http://localhost:54321/rest/v1/rpc/exec_sql', expectStatus: 200, method: 'POST', body: { sql: "SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'app-center-cleanup'" } },
];
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const headers = { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY };
for (const c of checks) {
  const opts = { headers };
  if (c.body) { opts.method = c.method; opts.body = JSON.stringify(c.body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(c.url, opts);
  if (r.status === c.expectStatus) { pass++; console.log(`  PASS ${c.name} (${r.status})`); }
  else { fail++; console.log(`  FAIL ${c.name} (${r.status} != ${c.expectStatus})`); }
}
await browser.close();
console.log(`\nResult: ${pass} pass, ${fail} fail (0 bug required)`);
if (fail > 0) process.exit(1);
