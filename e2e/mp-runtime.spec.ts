// e2e/mp-runtime.spec.ts
// MP-V6-MP-RUNTIME-01: mp-runtime Edge Functions (trigger / status / cancel)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
// Supabase local dev defaults (per `supabase status`). Override with SUPABASE_* env vars.
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('mp-runtime (MP-V6-MP-RUNTIME-01)', () => {
  let tenantA: string;
  let tenantB: string;
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let userAJwt: string;
  let userBJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      ['rt-a-' + suffix, 'Runtime A']
    )).rows[0].id;
    tenantB = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      ['rt-b-' + suffix, 'Runtime B']
    )).rows[0].id;

    // ensure the global function registry has a known entry (seeded by migration)
    const fn = await c.query("SELECT count(*)::int AS n FROM mp_runtime.functions WHERE name = 'mp-runtime-hello'");
    if (fn.rows[0].n !== 1) {
      throw new Error('Seed function mp-runtime-hello missing — migration not applied');
    }

    // admin user in tenant A
    const r1 = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rt-a-' + suffix + '@x.com', password: 'Test123!', email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    userA = await r1.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userA.id, tenantA, userA.email]);
    const r2 = await fetch(API + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await r2.json()).access_token;

    // admin user in tenant B (for cross-tenant RLS test)
    const r3 = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rt-b-' + suffix + '@x.com', password: 'Test123!', email_confirm: true,
        app_metadata: { tenant_id: tenantB, role: 'admin' },
      }),
    });
    userB = await r3.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userB.id, tenantB, userB.email]);
    const r4 = await fetch(API + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userB.email, password: 'Test123!' }),
    });
    userBJwt = (await r4.json()).access_token;

    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query("DELETE FROM mp_runtime.sessions WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
    await c.query("DELETE FROM public.audit_log WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
    await c.query("DELETE FROM public.profiles WHERE id IN ($1, $2)", [userA.id, userB.id]);
    await c.query("DELETE FROM public.tenants WHERE id IN ($1, $2)", [tenantA, tenantB]);
    await c.end();
    await fetch(API + '/auth/v1/admin/users/' + userA.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
    await fetch(API + '/auth/v1/admin/users/' + userB.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
  });

  test('1. trigger -> status happy path (queued session retrievable)', async () => {
    // trigger
    const r = await fetch(API + '/functions/v1/mp-runtime-trigger', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function_name: 'mp-runtime-hello',
        input_payload: { greeting: 'hi', n: 42 },
        priority: 'normal',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.status).toBe('queued');
    expect(body.function_name).toBe('mp-runtime-hello');
    expect(body.function_version).toBe('1.0.0');
    expect(body.tenant_id).toBe(tenantA);
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);

    // status
    const r2 = await fetch(API + '/functions/v1/mp-runtime-status?session_id=' + body.session_id, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY },
    });
    expect(r2.status).toBe(200);
    const status = await r2.json();
    expect(status.session_id).toBe(body.session_id);
    expect(status.status).toBe('queued');
    expect(status.function_name).toBe('mp-runtime-hello');
    expect(status.tenant_id).toBe(tenantA);

    // DB verify
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r3 = await c.query(
      "SELECT status, function_name FROM mp_runtime.sessions WHERE id = $1 AND tenant_id = $2",
      [body.session_id, tenantA]
    );
    expect(r3.rows[0].status).toBe('queued');
    expect(r3.rows[0].function_name).toBe('mp-runtime-hello');
    await c.end();
  });

  test('2. trigger unknown function -> 404', async () => {
    const r = await fetch(API + '/functions/v1/mp-runtime-trigger', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ function_name: 'mp-runtime-nonexistent-' + Date.now() }),
    });
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toContain('function not registered');
  });

  test('3. cancel running session -> status=cancelled, finished_at set', async () => {
    // trigger a fresh session
    const t = await fetch(API + '/functions/v1/mp-runtime-trigger', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ function_name: 'mp-runtime-hello', input_payload: { task: 'to-cancel' } }),
    });
    expect(t.status).toBe(201);
    const trig = await t.json();
    const sessionId = trig.session_id;

    // manually flip to 'running' so cancel has something to cancel from a real state
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query("UPDATE mp_runtime.sessions SET status = 'running' WHERE id = $1", [sessionId]);
    await c.end();

    // cancel
    const r = await fetch(API + '/functions/v1/mp-runtime-cancel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, reason: 'E2E test cancel' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('cancelled');
    expect(body.previous_status).toBe('running');
    expect(body.cancelled_at).toBeTruthy();

    // status now reflects cancelled
    const r2 = await fetch(API + '/functions/v1/mp-runtime-status?session_id=' + sessionId, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY },
    });
    expect(r2.status).toBe(200);
    const status = await r2.json();
    expect(status.status).toBe('cancelled');
    expect(status.error_message).toContain('E2E test cancel');

    // re-cancel should 409 (already terminal)
    const r3 = await fetch(API + '/functions/v1/mp-runtime-cancel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    expect(r3.status).toBe(409);
  });

  test('4. cross-tenant RLS: tenantB cannot read tenantA session via status', async () => {
    // tenant A creates a session
    const t = await fetch(API + '/functions/v1/mp-runtime-trigger', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ function_name: 'mp-runtime-hello', input_payload: { tenant: 'A' } }),
    });
    expect(t.status).toBe(201);
    const trig = await t.json();
    const sessionId = trig.session_id;

    // tenant B attempts to read it -> should 404 (RLS hides row)
    const r = await fetch(API + '/functions/v1/mp-runtime-status?session_id=' + sessionId, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + userBJwt, 'apikey': ANON_KEY },
    });
    expect(r.status).toBe(404);

    // tenant B attempts to cancel it -> should also 404
    const r2 = await fetch(API + '/functions/v1/mp-runtime-cancel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + userBJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    expect(r2.status).toBe(404);

    // tenant A can still see it
    const r3 = await fetch(API + '/functions/v1/mp-runtime-status?session_id=' + sessionId, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY },
    });
    expect(r3.status).toBe(200);
  });
});