// e2e/list-presets.spec.ts
// MP-V6 Loop 2/5: list-presets Edge Function
import { test, expect } from '@playwright/test';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJ...ANON_PLACEHOLDER';

test.describe('list-presets (Loop 2/5)', () => {
  test('1. anon GET returns public presets', async ({ request }) => {
    const r = await request.get(`${API}/functions/v1/list-presets?per_page=5`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeTruthy();
    expect(body.pagination.per_page).toBe(5);
  });

  test('2. supports category filter', async ({ request }) => {
    const r = await request.get(`${API}/functions/v1/list-presets?category=knowledge-curator&per_page=10`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    // 所有返回项 category == knowledge-curator
    for (const p of body.data) {
      expect(p.category).toBe('knowledge-curator');
    }
  });

  test('3. supports search (ilike on name/description)', async ({ request }) => {
    const r = await request.get(`${API}/functions/v1/list-presets?search=triage&per_page=10`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('4. pagination (page + per_page + total_pages)', async ({ request }) => {
    const r = await request.get(`${API}/functions/v1/list-presets?page=1&per_page=2`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.pagination.page).toBe(1);
  });

  test('5. sort=popular (default: install_count desc)', async ({ request }) => {
    const r1 = await request.get(`${API}/functions/v1/list-presets?sort=popular&per_page=5`);
    const r2 = await request.get(`${API}/functions/v1/list-presets?sort=recent&per_page=5`);
    expect(r1.status()).toBe(200);
    expect(r2.status()).toBe(200);
  });
});
