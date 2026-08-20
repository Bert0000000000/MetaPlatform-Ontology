// e2e/multimodal-rag-video.spec.ts
// MP-V6.1 Multimodal RAG Phase 2: video embedding via BLIP-2 frame-by-frame (Issue #TBD)
// Per ADR-0065 §2/§3 — PoC with mock (real impl = FastAPI sidecar with BLIP-2)

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// FK-safe cleanup of leftover mm-v-* data from previous failed runs.
// video_embeddings -> image_embeddings (FK); each delete writes its own audit_log row,
// so we purge audit_log AFTER all child deletes but BEFORE tenants.
async function cleanupMmVData(c: pg.Client): Promise<void> {
  await c.query("DELETE FROM public.video_embeddings WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug LIKE 'mm-v-%')");
  await c.query("DELETE FROM public.image_embeddings WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug LIKE 'mm-v-%')");
  await c.query("DELETE FROM public.profiles WHERE email LIKE 'mm-v-%@x.com'");
  await c.query("DELETE FROM public.audit_log WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug LIKE 'mm-v-%')");
  await c.query("DELETE FROM public.tenants WHERE slug LIKE 'mm-v-%'");
  await c.query("DELETE FROM auth.users WHERE email LIKE 'mm-v-%@x.com'");
}

test.describe('multimodal-rag-video PoC (Phase 2)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    await cleanupMmVData(c);
    const suffix = Date.now();
    tenantA = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['mm-v-' + suffix, 'MM Video Test'])).rows[0].id;
    const r = await fetch(API + '/auth/v1/admin/users', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SERVICE_KEY, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mm-v-' + suffix + '@x.com', password: 'Test123!', email_confirm: true, app_metadata: { tenant_id: tenantA, role: 'admin' } }),
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
    // Delete child rows first (each writes audit_log); then audit_log; then tenant; then auth.users.
    await c.query('DELETE FROM public.video_embeddings WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.image_embeddings WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.profiles WHERE id = $1', [userA.id]);
    await c.query('DELETE FROM public.audit_log WHERE tenant_id = $1', [tenantA]);
    await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]);
    await c.query('DELETE FROM auth.users WHERE id = $1', [userA.id]);
    await c.end();
  });

  test('1. embed-video (admin) -> 201 (BLIP-2 PoC, keyframes per fps)', async () => {
    const r = await fetch(API + '/functions/v1/embed-video', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: 'https://example.com/test-phase2.mp4',
        fps: 2,
        video_duration_sec: 5,
        metadata: { caption: 'phase 2 test video' },
      }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.model).toBe('blip-2');
    expect(body.dimensions).toBe(512);
    expect(body.keyframe_count).toBe(10); // 5s * 2fps = 10 frames
    expect(body.video_hash).toBeTruthy();
    expect(Array.isArray(body.frames)).toBe(true);
    expect(body.frames.length).toBe(10);
    // verify each frame has frame_index + timestamp + image_embedding_id linked
    for (const f of body.frames) {
      expect(typeof f.frame_index).toBe('number');
      expect(typeof f.frame_timestamp_sec).toBe('number');
      expect(f.embedding_id).toBeTruthy();
      expect(f.image_embedding_id).toBeTruthy();
    }
    // verify timestamps are evenly spaced (0, 0.5, 1, ..., 4.5)
    expect(body.frames[0].frame_timestamp_sec).toBe(0);
    expect(body.frames[1].frame_timestamp_sec).toBe(0.5);
    expect(body.frames[9].frame_timestamp_sec).toBe(4.5);
  });

  test('2. search-image finds video keyframe matches (image_embedding rows from Phase 2 are searchable via Phase 1)', async () => {
    const embedding = new Array(512).fill(0);
    const r = await fetch(API + '/functions/v1/search-image', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_embedding: embedding, limit: 20 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.results)).toBe(true);
    // test 1 inserted 10 image_embedding rows (Phase 1 reuse); we should find >= 10 of them
    expect(body.results.length).toBeGreaterThanOrEqual(10);
    // verify each result has the expected image structure
    // similarity may be "NaN" or "0" as string when comparing zero vectors; just confirm it's present
    for (const m of body.results) {
      expect(m.id).toBeTruthy();
      expect(m.image_url).toBeTruthy();
      expect(m.similarity !== undefined && m.similarity !== null).toBe(true);
    }
  });

  test('3. validation: missing video_url -> 400', async () => {
    const r = await fetch(API + '/functions/v1/embed-video', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + userAJwt, 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps: 1, metadata: { caption: 'no url' } }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toContain('video_url');
  });

  test('4. anon POST -> 401', async () => {
    const r = await fetch(API + '/functions/v1/embed-video', {
      method: 'POST', headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: 'https://example.com/x.mp4' }),
    });
    expect(r.status).toBe(401);
  });
});