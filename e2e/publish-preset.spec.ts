// e2e/publish-preset.spec.ts
// MetaPlatform Loop 3/5: publish-preset Edge Function

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
// Supabase local dev defaults (per `supabase status`). Override with SUPABASE_* env vars.
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('publish-preset (Loop 3/5)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      ['pub-' + suffix, 'Pub Test']
    )).rows[0].id;
    await c.end();

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pub-' + suffix + '@x.com', password: 'Test123!', email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    userA = await r.json();
    const r2 = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await r2.json()).access_token;

    const c2 = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c2.connect();
    await c2.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userA.id, tenantA, userA.email]);
    await c2.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // FK-safe cleanup: child rows (versions → presets) reference tenants, delete them first.
    try { await c.query("DELETE FROM mp_preset_registry.versions WHERE tenant_id = $1", [tenantA]); } catch (e) { /* ignore */ }
    try { await c.query("DELETE FROM mp_preset_registry.presets WHERE tenant_id = $1", [tenantA]); } catch (e) { /* ignore */ }
    try { await c.query("DELETE FROM public.audit_log WHERE tenant_id = $1", [tenantA]); } catch (e) { /* ignore */ }
    await c.query("DELETE FROM public.profiles WHERE id = $1", [userA.id]);
    await c.query("DELETE FROM public.tenants WHERE id = $1", [tenantA]);
    await c.end();
    await fetch(`${API}/auth/v1/admin/users/${userA.id}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    });
  });

  test('1. admin POST creates preset + version 201', async () => {
    const slug = 'my-preset-' + Date.now();
    const r = await fetch(`${API}/functions/v1/publish-preset`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        name: 'My Test Preset',
        description: 'Test preset',
        category: 'custom',
        version: '1.0.0',
        manifest: { tools: ['echo'] },
        changelog: 'Initial release',
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.slug).toBe(slug);
    expect(body.version).toBe('1.0.0');

    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r1 = await c.query("SELECT count(*)::int AS n FROM mp_preset_registry.presets WHERE slug = $1", [slug]);
    const r2 = await c.query("SELECT count(*)::int AS n FROM mp_preset_registry.versions v JOIN mp_preset_registry.presets p ON v.preset_id = p.id WHERE p.slug = $1", [slug]);
    expect(r1.rows[0].n).toBe(1);
    expect(r2.rows[0].n).toBe(1);
    await c.end();
  });

  test('2. validation: invalid semver → 400', async () => {
    const r = await fetch(`${API}/functions/v1/publish-preset`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X', category: 'custom', version: 'not-semver', manifest: {} }),
    });
    expect(r.status).toBe(400);
  });

  test('3. duplicate slug → 409', async () => {
    const slug = 'dup-' + Date.now();
    const payload = {
      slug, name: 'Dup', category: 'custom', version: '1.0.0',
      manifest: { tools: ['echo'] },
    };
    const r1 = await fetch(`${API}/functions/v1/publish-preset`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(201);
    const r2 = await fetch(`${API}/functions/v1/publish-preset`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userAJwt}`, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(409);
  });

  test('4. anon POST → 401', async () => {
    const r = await fetch(`${API}/functions/v1/publish-preset`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'a', name: 'A', category: 'custom', version: '1.0.0', manifest: {} }),
    });
    expect(r.status).toBe(401);
  });
});
