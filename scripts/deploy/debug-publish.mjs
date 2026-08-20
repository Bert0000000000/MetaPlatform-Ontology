// scripts/deploy/debug-publish.mjs - debug publish-preset
import pg from 'pg';

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://localhost:54321';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();

const suffix = Date.now();
const t = await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['test-' + suffix, 'Test']);
const tenantA = t.rows[0].id;

const r = await fetch(API + '/auth/v1/admin/users', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
});
const user = await r.json();
console.log('user:', user.id);

await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [user.id, tenantA, user.email]);

const r2 = await fetch(API + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: 'Test123!' }),
});
const jwt = (await r2.json()).access_token;
console.log('JWT len:', jwt.length);

const r3 = await fetch(API + '/functions/v1/publish-preset', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'test-' + suffix, name: 'Test Preset', description: 'd', category: 'custom', version: '1.0.0', manifest: { tools: ['x'] } }),
});
console.log('publish-preset status:', r3.status);
console.log('body:', (await r3.text()).slice(0, 500));

// Cleanup
await c.query("DELETE FROM public.profiles WHERE id = $1", [user.id]);
await c.query("DELETE FROM public.tenants WHERE id = $1", [tenantA]);
await fetch(API + '/auth/v1/admin/users/' + user.id, {
  method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY },
});
await c.end();
