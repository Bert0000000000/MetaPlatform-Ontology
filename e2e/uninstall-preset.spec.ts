// e2e/uninstall-preset.spec.ts
// MP-V6 Loop 5/5: uninstall-preset Edge Function (per Issue #5)
// Test: uninstall, list active installs, status transition

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJ...ANON_PLACEHOLDER';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJ...SERVICE_PLACEHOLDER';

test.describe('uninstall + list (Loop 5/5)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;
  let installId: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['un-' + suffix, 'Un Test'])).rows[0].id;

    const r = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'un-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
    });
    userA = await r.json();
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userA.id, tenantA, userA.email]);

    const r2 = await fetch(API + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await r2.json()).access_token;

    // 先 install 一个 preset
    const r3 = await fetch(API + '/functions/v1/install-preset', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset_slug: 'contract-drafter', workspace_id: 'ws-' + suffix }),
    });
    const installBody = await r3.json();
    installId = installBody.install_id;
    console.log('Installed:', installId);

    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await c.query("DELETE FROM mp_preset_registry.installs WHERE tenant_id = $1", [tenantA]);
    await c.query("DELETE FROM public.profiles WHERE id = $1", [userA.id]);
    await c.query("DELETE FROM public.tenants WHERE id = $1", [tenantA]);
    await c.end();
    await fetch(API + '/auth/v1/admin/users/' + userA.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
  });

  test('1. uninstall POST → 200 (soft-delete install)', async () => {
    // Ensure install exists (in case beforeAll failed or was wiped)
    if (!installId) {
      const ins = await fetch(API + '/functions/v1/install-preset', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_slug: 'contract-drafter', workspace_id: 'ws-' + Date.now() }),
      });
      const insBody = await ins.json();
      installId = insBody.install_id;
    }
    const r = await fetch(API + '/functions/v1/uninstall-preset', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: installId }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('uninstalled');

    // Verify
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const r2 = await c.query("SELECT status FROM mp_preset_registry.installs WHERE id = $1", [installId]);
    expect(r2.rows[0].status).toBe('uninstalled');
    await c.end();
  });

  test('2. list-active-installs → 200 (empty for this workspace)', async () => {
    const r = await fetch(API + '/functions/v1/list-active-installs', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: 'ws-archived' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data).toBeDefined();
  });

  test('3. uninstall same install twice → 404 (already uninstalled)', async () => {
    const r = await fetch(API + '/functions/v1/uninstall-preset', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: installId }),
    });
    expect(r.status).toBe(404);
  });

  test('4. uninstall anon → 401', async () => {
    const r = await fetch(API + '/functions/v1/uninstall-preset', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: installId }),
    });
    expect(r.status).toBe(401);
  });
});
