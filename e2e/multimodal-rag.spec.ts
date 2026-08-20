// e2e/multimodal-rag.spec.ts
// MP-V6.1 Multimodal RAG PoC (Issue #9)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJ...ANON_PLACEHOLDER';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJ...SERVICE_PLACEHOLDER';

test.describe('multimodal-rag PoC (Loop 5/5)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['mm-' + suffix, 'MM Test'])).rows[0].id;
    const r = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mm-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
    });
    userA = await r.json();
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
    await c.query('DELETE FROM public.image_embeddings WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id = $1', [userA.id]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.end();
    await fetch(API + '/auth/v1/admin/users/' + userA.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY } });
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
