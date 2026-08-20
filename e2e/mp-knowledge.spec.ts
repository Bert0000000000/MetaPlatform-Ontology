// e2e/mp-knowledge.spec.ts
// MP-V6 mp-knowledge PoC (Issue #15) — orchestration layer E2E
//
// Coverage:
//   1. basic search -> 200 + results array
//   2. with top_k param -> returns <= top_k
//   3. cache hit (same query returns faster)
//   4. validation: missing query -> 400
//   5. auth: anon -> 401

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
// Supabase local dev defaults (per `supabase status`). Override with SUPABASE_* env vars.
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('mp-knowledge (Issue #15 PoC)', () => {
  let tenantA: string;
  let userA: { id: string; email: string };
  let userAJwt: string;

  test.beforeAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    const suffix = Date.now();
    tenantA = (await c.query(
      "INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id",
      [`mpk-${suffix}`, 'MP Knowledge E2E']
    )).rows[0].id;

    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `mpk-${suffix}@x.com`,
        password: 'Test123!',
        email_confirm: true,
        app_metadata: { tenant_id: tenantA, role: 'admin' },
      }),
    });
    userA = await r.json();
    await c.query(
      "INSERT INTO public.profiles (id, tenant_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [userA.id, tenantA, userA.email]
    );

    const r2 = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: 'Test123!' }),
    });
    userAJwt = (await r2.json()).access_token;
    await c.end();
  });

  test.afterAll(async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    try { await c.query('DELETE FROM public.profiles WHERE id = $1', [userA.id]); } catch (e) { /* ignore */ }
    try { await c.query('DELETE FROM public.tenants WHERE id = $1', [tenantA]); } catch (e) { /* ignore */ }
    await c.end();
    try {
      await fetch(`${API}/auth/v1/admin/users/${userA.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      });
    } catch (e) { /* ignore */ }
  });

  test('1. basic search -> 200 + results array', async () => {
    const r = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAJwt}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'production deployment best practices' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('query');
    expect(body).toHaveProperty('mode');
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body).toHaveProperty('quality_score');
    expect(typeof body.quality_score).toBe('number');
    expect(body.quality_score).toBeGreaterThanOrEqual(0);
    expect(body.quality_score).toBeLessThanOrEqual(1);
    expect(body).toHaveProperty('cache_hit');
    expect(body).toHaveProperty('degraded');
    expect(body).toHaveProperty('stats');
    // PoC may run with RAGFlow/GraphRAG absent → degraded true, results empty
    if (!body.degraded) {
      expect(body.results.length).toBeGreaterThan(0);
      const first = body.results[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('content');
      expect(first).toHaveProperty('score');
      expect(first).toHaveProperty('source');
      expect(['ragflow', 'graphrag']).toContain(first.source);
    }
  });

  test('2. with top_k param -> returns <= top_k', async () => {
    const r = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAJwt}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'kubernetes networking policy', top_k: 3 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results.length).toBeLessThanOrEqual(3);
    if (!body.degraded) {
      expect(body.results.length).toBeGreaterThan(0);
    }
  });

  test('3. cache hit -> second call has cache_hit=true (or degraded if upstream down)', async () => {
    const query = 'microservices circuit breaker pattern ' + Date.now();
    const r1 = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAJwt}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, top_k: 5 }),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.cache_hit).toBe(false);

    // second call must hit cache (cache key uses tenant + mode + top_k + rewritten query)
    const r2 = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAJwt}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, top_k: 5 }),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    // if first call was degraded (no upstream), we don't cache; so cache_hit stays false
    // otherwise we MUST get cache_hit=true on second call
    if (!b1.degraded) {
      expect(b2.cache_hit).toBe(true);
      // cached payload should equal original
      expect(b2.results).toEqual(b1.results);
    } else {
      // degraded path: not cached, just verify shape
      expect(b2.cache_hit).toBe(false);
      expect(b2.degraded).toBe(true);
    }
  });

  test('4. validation: missing query -> 400', async () => {
    const r = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAJwt}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ top_k: 5 }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('missing_query');
  });

  test('5. auth: anon -> 401', async () => {
    const r = await fetch(`${API}/functions/v1/mp-knowledge`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello world' }),
    });
    expect(r.status).toBe(401);
  });
});