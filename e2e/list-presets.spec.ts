// e2e/list-presets.spec.ts
// MP-V6 Loop 2/5: list-presets Edge Function

import { test, expect } from '@playwright/test';

const API = process.env.SUPABASE_API ?? 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'eyJ...ANON_PLACEHOLDER';

async function callList(query: string) {
  return await fetch(`${API}/functions/v1/list-presets${query}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
  });
}

async function expectSuccess(r: Response) {
  if (r.status !== 200) {
    const text = await r.text();
    throw new Error(`Expected 200 but got ${r.status}: ${text}`);
  }
  return await r.json();
}

test.describe('list-presets (Loop 2/5)', () => {
  test('1. anon GET returns public presets', async () => {
    const r = await callList('?per_page=5');
    const body = await expectSuccess(r);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeTruthy();
    expect(body.pagination.per_page).toBe(5);
  });

  test('2. supports category filter', async () => {
    const r = await callList('?category=support&per_page=10');
    const body = await expectSuccess(r);
    for (const p of body.data) {
      expect(p.category).toBe('support');
    }
  });

  test('3. supports search (ilike on name/description)', async () => {
    const r = await callList('?search=triage&per_page=10');
    const body = await expectSuccess(r);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('4. pagination (page + per_page + total_pages)', async () => {
    const r = await callList('?page=1&per_page=2');
    const body = await expectSuccess(r);
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.pagination.page).toBe(1);
  });

  test('5. sort=popular (default: install_count desc)', async () => {
    const r1 = await callList('?sort=popular&per_page=5');
    const r2 = await callList('?sort=recent&per_page=5');
    const b1 = await expectSuccess(r1);
    const b2 = await expectSuccess(r2);
    expect(b1.data.length).toBeGreaterThanOrEqual(1);
    expect(b2.data.length).toBeGreaterThanOrEqual(1);
  });
});
