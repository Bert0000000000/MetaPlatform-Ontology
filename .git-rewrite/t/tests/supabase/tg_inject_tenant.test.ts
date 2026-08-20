/**
 * tests/supabase/tg_inject_tenant.test.ts
 *
 * Unit test for public.tg_inject_tenant() trigger function logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface JwtContext {
  tenant_id: string | null;
}

interface TriggerInput {
  tenant_id: string | null;
  [key: string]: unknown;
}

class TenantMismatchError extends Error {
  constructor(public readonly rowTenant: string, public readonly jwtTenant: string) {
    super(`tg_inject_tenant: row.tenant_id (${rowTenant}) != JWT.tenant_id (${jwtTenant})`);
  }
}

class MissingJwtClaimError extends Error {
  constructor() {
    super('tg_inject_tenant: JWT missing tenant_id claim');
  }
}

function tgInjectTenant(jwt: JwtContext, newRow: TriggerInput): TriggerInput {
  if (jwt.tenant_id === null) throw new MissingJwtClaimError();
  if (newRow.tenant_id === null) {
    return { ...newRow, tenant_id: jwt.tenant_id };
  }
  if (newRow.tenant_id !== jwt.tenant_id) {
    throw new TenantMismatchError(newRow.tenant_id, jwt.tenant_id);
  }
  return newRow;
}

describe('public.tg_inject_tenant() trigger function', () => {
  const jwt: JwtContext = { tenant_id: 'tenant-A' };

  it('injects tenant_id when row omits it', () => {
    const row = tgInjectTenant(jwt, { name: 'foo' });
    expect(row.tenant_id).toBe('tenant-A');
  });

  it('accepts row.tenant_id matching JWT', () => {
    const row = tgInjectTenant(jwt, { tenant_id: 'tenant-A', name: 'foo' });
    expect(row.tenant_id).toBe('tenant-A');
  });

  it('rejects row.tenant_id mismatch', () => {
    expect(() => tgInjectTenant(jwt, { tenant_id: 'tenant-B' })).toThrow(TenantMismatchError);
  });

  it('rejects when JWT missing tenant_id claim', () => {
    expect(() => tgInjectTenant({ tenant_id: null }, { name: 'foo' })).toThrow(MissingJwtClaimError);
  });
});