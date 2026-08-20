// quick test: create tenant + user, login, POST embed-video
import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const suffix = Date.now();
const tenant = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['ve-' + suffix, 'VE Test'])).rows[0].id;
const r = await fetch('http://localhost:54321/auth/v1/admin/users', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 've-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenant, role: 'admin' } }),
});
const user = await r.json();
await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [user.id, tenant, user.email]);
const r2 = await fetch('http://localhost:54321/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: 'Test123!' }),
});
const jwt = (await r2.json()).access_token;
console.log('tenant:', tenant, 'user:', user.id);

const v = await fetch('http://localhost:54321/functions/v1/embed-video', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ video_url: 'https://example.com/test.mp4', fps: 1, video_duration_sec: 5, metadata: { caption: 'test video' } }),
});
console.log('embed-video status:', v.status);
const body = await v.json();
console.log('body:', JSON.stringify(body, null, 2));

// validation test
const v2 = await fetch('http://localhost:54321/functions/v1/embed-video', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
console.log('validation status (empty body, expect 400):', v2.status);
const v2body = await v2.json();
console.log('validation body:', v2body);

// anon test
const v3 = await fetch('http://localhost:54321/functions/v1/embed-video', {
  method: 'POST',
  headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ video_url: 'https://example.com/x.mp4' }),
});
console.log('anon status (expect 401):', v3.status);

// search-image test - should find our 5 frames
const emb = new Array(512).fill(0);
const s = await fetch('http://localhost:54321/functions/v1/search-image', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', 'Content-Type': 'application/json' },
  body: JSON.stringify({ query_embedding: emb, limit: 5 }),
});
console.log('search-image status:', s.status);
const sbody = await s.json();
console.log('search-image count:', sbody.count);

// cleanup
await c.query('DELETE FROM public.video_embeddings WHERE tenant_id = $1', [tenant]);
await c.query('DELETE FROM public.image_embeddings WHERE tenant_id = $1', [tenant]);
await c.query('DELETE FROM public.profiles WHERE id = $1', [user.id]);
await c.query('DELETE FROM public.tenants WHERE id = $1', [tenant]);
await fetch('http://localhost:54321/auth/v1/admin/users/' + user.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' } });
await c.end();
