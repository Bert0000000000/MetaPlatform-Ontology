import pg from 'pg';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const suffix = Date.now();
const t = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['dbg-inst-' + suffix, 'Dbg'])).rows[0].id;
const r = await fetch('http://localhost:54321/auth/v1/admin/users', {
  method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dbg-inst-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: t, role: 'admin' } }),
});
const user = await r.json();
await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [user.id, t, user.email]);
const r2 = await fetch('http://localhost:54321/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: 'Test123!' }),
});
const jwt = (await r2.json()).access_token;
const r3 = await fetch('http://localhost:54321/functions/v1/install-preset', {
  method: 'POST', headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ preset_slug: 'contract-drafter', workspace_id: 'ws-test-' + suffix }),
});
console.log('status:', r3.status);
console.log('body:', await r3.text());
await c.query("DELETE FROM mp_preset_registry.installs WHERE tenant_id = $1", [t]);
await c.query("DELETE FROM public.profiles WHERE id = $1", [user.id]);
await c.query("DELETE FROM public.tenants WHERE id = $1", [t]);
await fetch('http://localhost:54321/auth/v1/admin/users/' + user.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
await c.end();
