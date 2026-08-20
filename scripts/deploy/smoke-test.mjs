import pg from 'pg';
const { Client } = pg;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGc...ANON_PLACEHOLDER';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGc...SERVICE_PLACEHOLDER';
const API = 'http://localhost:54321';

const pgClient = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await pgClient.connect();

// 1. Create 2 tenants via service_role SQL
console.log('=== Setup: Create 2 tenants ===');
const tenantA = (await pgClient.query(
  "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id, slug",
  [`tenant-a-${Date.now()}`, 'Tenant A']
)).rows[0];
const tenantB = (await pgClient.query(
  "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id, slug",
  [`tenant-b-${Date.now()}`, 'Tenant B']
)).rows[0];
console.log(`   tenantA: ${tenantA.id}`);
console.log(`   tenantB: ${tenantB.id}`);

// 2. Create 2 users (one per tenant) via supabase auth admin
console.log('\n=== Setup: Create 2 users (one per tenant) ===');
async function createUser(email, tenantId) {
  const r = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPassword123!', email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: 'admin' },
    }),
  });
  return (await r.json());
}
const userA = await createUser(`user-a-${Date.now()}@example.com`, tenantA.id);
const userB = await createUser(`user-b-${Date.now()}@example.com`, tenantB.id);
console.log(`   userA: ${userA.id} (tenant=${userA.app_metadata?.tenant_id})`);
console.log(`   userB: ${userB.id} (tenant=${userB.app_metadata?.tenant_id})`);

// 3. Create profiles for both users
await pgClient.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)",
  [userA.id, tenantA.id, userA.email, 'admin']);
await pgClient.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, $4)",
  [userB.id, tenantB.id, userB.email, 'admin']);

// 4. Test JWT-based Edge Function call (create-customer)
console.log('\n=== Test 1: create-customer as userA (tenant A) ===');
async function callFn(name, body, jwt) {
  const r = await fetch(`${API}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.text() };
}

// Need to login userA to get user JWT (admin signup gives different role)
const loginA = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: userA.email, password: 'TestPassword123!' }),
});
const userAJwt = (await loginA.json()).access_token;
console.log(`   userA login JWT: ${userAJwt?.slice(0, 30)}...`);

let r = await callFn('create-customer', { name: 'Cust A1', contact_email: `a1-${Date.now()}@x.com` }, userAJwt);
console.log(`   create-customer status: ${r.status}`);
console.log(`   body: ${r.data.slice(0, 200)}`);

// 5. Verify customer in tenant A
console.log('\n=== Test 2: verify customer in tenant A only ===');
const custInA = (await pgClient.query("SELECT count(*)::int AS n FROM public.customers WHERE tenant_id = $1", [tenantA.id])).rows[0];
const custInB = (await pgClient.query("SELECT count(*)::int AS n FROM public.customers WHERE tenant_id = $1", [tenantB.id])).rows[0];
console.log(`   customers in tenant A: ${custInA.n}`);
console.log(`   customers in tenant B: ${custInB.n} (should be 0)`);

// 6. Test 3: audit_log has INSERT event
console.log('\n=== Test 3: audit_log captured create-customer ===');
const audit = (await pgClient.query(
  "SELECT count(*)::int AS n, array_agg(DISTINCT action) AS actions FROM public.audit_log WHERE tenant_id = $1",
  [tenantA.id]
)).rows[0];
console.log(`   audit_log entries: ${audit.n}, actions: ${JSON.stringify(audit.actions)}`);

// 7. Test 4: ticket-triage (high priority → HITL)
console.log('\n=== Test 4: ticket-triage (urgent ticket → HITL) ===');
r = await callFn('ticket-triage', {
  ticket_id: '00000000-0000-0000-0000-000000000000',  // fake
  auto_apply: false,
}, userAJwt);
console.log(`   ticket-triage status: ${r.status}, body: ${r.data.slice(0, 200)}`);

// 8. Test 5: send-notification
console.log('\n=== Test 5: send-notification (Realtime broadcast) ===');
r = await callFn('send-notification', {
  recipient_user_ids: [userA.id],
  title: 'Test notification',
  body: 'Hello from E2E test',
  channels: ['realtime'],
  priority: 'normal',
}, userAJwt);
console.log(`   send-notification status: ${r.status}, body: ${r.data.slice(0, 200)}`);

// 9. Cleanup (order matters: audit_log → profiles → tenants)
console.log('\n=== Cleanup ===');
await pgClient.query("DELETE FROM public.audit_log WHERE tenant_id IN ($1, $2)", [tenantA.id, tenantB.id]);
await pgClient.query("DELETE FROM public.customers WHERE tenant_id IN ($1, $2)", [tenantA.id, tenantB.id]);
await pgClient.query("DELETE FROM public.profiles WHERE id IN ($1, $2)", [userA.id, userB.id]);
await pgClient.query("DELETE FROM public.tenants WHERE id IN ($1, $2)", [tenantA.id, tenantB.id]);
console.log('   ✅ Cleaned up test data');

await pgClient.end();
console.log('\n=== 🎉 E2E Smoke Test Complete ===');
