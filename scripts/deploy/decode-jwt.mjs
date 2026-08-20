import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const r = await c.query("SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1");
console.log('user:', r.rows[0]);
const r2 = await fetch('http://localhost:54321/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: r.rows[0].email, password: 'Test123!' }),
});
const data = await r2.json();
console.log('login:', r2.status);
console.log('keys:', Object.keys(data));
if (data.access_token) {
  const payload = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64').toString());
  console.log('sub:', payload.sub);
  console.log('tenant_id:', payload.tenant_id);
  console.log('role:', payload.role);
  console.log('keys:', Object.keys(payload));
}
await c.end();
