// e2e/multimodal-rag.spec.ts
// MP-V6.1 Multimodal RAG PoC (Issue #9)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
// Real keys (match supabase/.temp/.../docker.env + scripts/dev/dsh-web.sh)
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// FK-safe cleanup of leftover mm-* data from previous failed runs.
// Delete child rows first (each child delete writes its own audit_log row via the
// trigger), then purge audit_log, then the tenants themselves.
async function cleanupMmData(c: pg.Client): Promise<void> {
  await c.query("DELETE FROM public.image_embeddings WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug LIKE 'mm-%')");
  await c.query("DELETE FROM public.profiles WHERE email LIKE 'mm-%@x.com'");
  await c.query("DELETE FROM public.audit_log WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug LIKE 'mm-%')");
  await c.query("DELETE FROM public.tenants WHERE slug LIKE 'mm-%'");
  await c.query("DELETE FROM auth.users WHERE email LIKE 'mm-%@x.com'");
}

test.describe('multimodal-rag PoC (Loop 5/5)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();

    // Pre-clean: remove leftover mm-* data from previous failed runs (FK-safe order).
    // Without this, a prior afterAll that didn't run leaves audit_log rows referencing
    // deleted tenants, blocking future tenant creation / causing FK violations.
    await cleanupMmData(c);

    const suffix = Date.now();
    tenantA = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['mm-' + suffix, 'MM Test'])).rows[0].id;
    const r = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mm-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
    });
    const userJson = await r.json();
    if (!r.ok || !userJson.id) {
      throw new Error('admin/users failed: status=' + r.status + ' body=' + JSON.stringify(userJson).slice(0, 300));
    }
    userA = userJson;
    await c.query("INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')", [userA.id, tenantA, userA.email]);
    const r2 = await fetch(API + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await r2.json()).access_token;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // Delete child rows first; each delete creates its own audit_log entry, so
    // we must purge audit_log AFTER all child deletes but BEFORE tenant delete.
    await c.query('DELETE FROM public.image_embeddings WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id = $1', [userA.id]);
    await c.query("DELETE FROM public.audit_log WHERE tenant_id = $1", [tenantA]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.query('DELETE FROM auth.users WHERE id = $1', [userA.id]);
    await c.end();
  });

  test('1. embed-image -> 201 (CLIP 512-dim zero vector PoC)', async () => {
    const r = await fetch(API + '/functions/v1/embed-image', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: 'https://example.com/test.jpg', metadata: { caption: 'test image' } }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.dimensions).toBe(512);
    expect(body.model).toBe('clip-vit-b32');
    expect(body.image_hash).toBeTruthy();
  });

  test('2. search-image (query_embedding) -> 200, returns matches', async () => {
    const embedding = new Array(512).fill(0);
    const r = await fetch(API + '/functions/v1/search-image', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_embedding: embedding, limit: 5 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  test('3. validation: query_embedding wrong size -> 400', async () => {
    const r = await fetch(API + '/functions/v1/search-image', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_embedding: [0.1, 0.2, 0.3] }),
    });
    expect(r.status).toBe(400);
  });

  test('4. embed-image anon -> 401', async () => {
    const r = await fetch(API + '/functions/v1/embed-image', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: 'https://example.com/x.jpg' }),
    });
    expect(r.status).toBe(401);
  });
});
