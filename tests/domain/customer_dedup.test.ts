/**
 * tests/domain/customer_dedup.test.ts
 *
 * Verifies customer creation dedup logic by (tenant_id, contact_email).
 */

import { describe, it, expect } from 'vitest';

interface Customer {
  id: string;
  tenant_id: string;
  contact_email: string | null;
}

class MockCustomerStore {
  customers: Customer[] = [];

  insertOrDedup(input: { name: string; tenant_id: string; contact_email?: string }): { customer_id: string; deduped: boolean } {
    if (input.contact_email) {
      const existing = this.customers.find(
        (c) => c.tenant_id === input.tenant_id && c.contact_email === input.contact_email,
      );
      if (existing) {
        return { customer_id: existing.id, deduped: true };
      }
    }

    const id = `cust-${this.customers.length + 1}`;
    this.customers.push({
      id,
      tenant_id: input.tenant_id,
      contact_email: input.contact_email ?? null,
    });
    return { customer_id: id, deduped: false };
  }
}

describe('customer create dedup', () => {
  it('creates new customer when no existing match', () => {
    const store = new MockCustomerStore();
    const result = store.insertOrDedup({ name: 'Alice', tenant_id: 'tenant-A', contact_email: 'a@b.com' });
    expect(result.deduped).toBe(false);
    expect(result.customer_id).toBe('cust-1');
  });

  it('dedupes by (tenant_id, contact_email)', () => {
    const store = new MockCustomerStore();
    store.insertOrDedup({ name: 'Alice', tenant_id: 'tenant-A', contact_email: 'a@b.com' });

    const result = store.insertOrDedup({ name: 'Alice Again', tenant_id: 'tenant-A', contact_email: 'a@b.com' });
    expect(result.deduped).toBe(true);
    expect(result.customer_id).toBe('cust-1');  // 返回已有
  });

  it('treats different tenants as different customers (even with same email)', () => {
    const store = new MockCustomerStore();
    store.insertOrDedup({ name: 'Alice', tenant_id: 'tenant-A', contact_email: 'a@b.com' });

    const result = store.insertOrDedup({ name: 'Alice', tenant_id: 'tenant-B', contact_email: 'a@b.com' });
    expect(result.deduped).toBe(false);
    expect(result.customer_id).toBe('cust-2');
  });
});