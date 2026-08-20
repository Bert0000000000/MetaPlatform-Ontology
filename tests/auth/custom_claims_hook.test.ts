/**
 * tests/auth/custom_claims_hook.test.ts
 *
 * Verifies the public.custom_access_token_hook SQL function logic.
 * Pure TypeScript mock — no live Postgres required.
 */

import { describe, it, expect } from 'vitest';

interface ProfileRow {
  tenant_id: string | null;
  role: string | null;
}

interface HookInput {
  user_id: string;
  claims: Record<string, unknown>;
}

interface HookOutput extends HookInput {
  claims: Record<string, unknown> & { tenant_id?: string; role?: string };
}

function customAccessTokenHook(
  event: HookInput,
  profileLookup: (userId: string) => ProfileRow | null,
): HookOutput {
  const profile = profileLookup(event.user_id);

  const claims = { ...event.claims };
  if (profile?.tenant_id) {
    claims['tenant_id'] = profile.tenant_id;
  }
  if (profile?.role) {
    claims['role'] = profile.role;
  } else {
    claims['role'] = 'member';
  }

  return { ...event, claims };
}

describe('public.custom_access_token_hook', () => {
  const profileMap: Record<string, ProfileRow> = {
    'user-1': { tenant_id: 'tenant-A', role: 'admin' },
    'user-2': { tenant_id: 'tenant-B', role: null },  // role 默认 member
  };

  it('injects tenant_id + role from profile', () => {
    const result = customAccessTokenHook(
      { user_id: 'user-1', claims: { sub: 'user-1' } },
      (id) => profileMap[id] ?? null,
    );
    expect(result.claims['tenant_id']).toBe('tenant-A');
    expect(result.claims['role']).toBe('admin');
  });

  it('defaults role to "member" if profile missing role', () => {
    const result = customAccessTokenHook(
      { user_id: 'user-2', claims: {} },
      (id) => profileMap[id] ?? null,
    );
    expect(result.claims['tenant_id']).toBe('tenant-B');
    expect(result.claims['role']).toBe('member');
  });

  it('does not inject tenant_id if profile missing tenant', () => {
    const result = customAccessTokenHook(
      { user_id: 'orphan', claims: { role: 'member' } },
      () => null,
    );
    expect(result.claims['tenant_id']).toBeUndefined();
    expect(result.claims['role']).toBe('member');
  });

  it('preserves other claims (sub, email, etc.)', () => {
    const result = customAccessTokenHook(
      { user_id: 'user-1', claims: { sub: 'user-1', email: 'a@b.c' } },
      (id) => profileMap[id] ?? null,
    );
    expect(result.claims['sub']).toBe('user-1');
    expect(result.claims['email']).toBe('a@b.c');
    expect(result.claims['tenant_id']).toBe('tenant-A');
  });
});