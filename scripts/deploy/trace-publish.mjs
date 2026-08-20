import pg from 'pg';
const { Client } = pg;

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const suffix = Date.now();
const t = await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['trace-' + suffix, 'Trace']);
const tenantA = t.rows[0].id;
const r = await fetch('http://localhost:54321/auth/v1/admin/users', {
  method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'trace-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
});
const user = await r.json();
await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [user.id, tenantA, user.email]);
const r2 = await fetch('http://localhost:54321/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: 'Test123!' }),
});
const lr = await r2.json();
console.log('login status:', r2.status, 'keys:', Object.keys(lr));
if (lr.access_token) {
  // Check JWT contents
  const parts = lr.access_token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  console.log('JWT payload keys:', Object.keys(payload));
  console.log('sub:', payload.sub);
  console.log('tenant_id:', payload.tenant_id);
  console.log('role:', payload.role);
  console.log('app_metadata:', JSON.stringify(payload.app_metadata));

  // Now call publish-preset
  const r3 = await fetch('http://localhost:54321/functions/v1/publish-preset', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + lr.access_token, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'trace-' + suffix, name: 'Trace Preset', description: 'd', category: 'custom', version: '1.0.0', manifest: { tools: ['x'] } }),
  });
  console.log('publish-preset status:', r3.status);
  console.log('body:', (await r3.text()).slice(0, 500));
}
await c.query("DELETE FROM public.profiles WHERE id = $1", [user.id]);
await c.query("DELETE FROM public.tenants WHERE id = $1", [tenantA]);
await fetch('http://localhost:54321/auth/v1/admin/users/' + user.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
await c.end();
