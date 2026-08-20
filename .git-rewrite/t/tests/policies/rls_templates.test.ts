/**
 * tests/policies/rls_templates.test.ts
 *
 * Verifies the RLS policy templates generate correct SQL given a sample table name.
 * No live Postgres required.
 */

import { describe, it, expect } from 'vitest';

interface PolicySpec {
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly table: string;
}

function generatePolicy(spec: PolicySpec): string {
  const { operation, table } = spec;
  const policyName = `rls_${table.replace(/\./g, '_')}_tenant_${operation.toLowerCase()}`;

  switch (operation) {
    case 'SELECT':
      return `CREATE POLICY ${policyName} ON ${table} FOR SELECT TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);`;
    case 'INSERT':
      return `CREATE POLICY ${policyName} ON ${table} FOR INSERT TO authenticated WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);`;
    case 'UPDATE':
      return `CREATE POLICY ${policyName} ON ${table} FOR UPDATE TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);`;
    case 'DELETE':
      return `CREATE POLICY ${policyName} ON ${table} FOR DELETE TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid AND (auth.jwt() ->> 'role') IN ('owner', 'admin'));`;
  }
}

describe('RLS policy templates', () => {
  const table = 'public.orders';

  it('generates SELECT policy with USING clause', () => {
    const sql = generatePolicy({ operation: 'SELECT', table });
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('USING (tenant_id = (auth.jwt() ->> \'tenant_id\')::uuid)');
    expect(sql).toContain(`ON ${table}`);
  });

  it('generates INSERT policy with WITH CHECK clause', () => {
    const sql = generatePolicy({ operation: 'INSERT', table });
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('WITH CHECK');
    expect(sql).not.toContain('USING');
  });

  it('generates UPDATE policy with both USING and WITH CHECK', () => {
    const sql = generatePolicy({ operation: 'UPDATE', table });
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('USING');
    expect(sql).toContain('WITH CHECK');
  });

  it('generates DELETE policy restricted to owner / admin', () => {
    const sql = generatePolicy({ operation: 'DELETE', table });
    expect(sql).toContain('FOR DELETE');
    expect(sql).toContain("'owner'");
    expect(sql).toContain("'admin'");
  });

  it('policy name is deterministic and lowercase', () => {
    const sql = generatePolicy({ operation: 'SELECT', table: 'public.Customer_Orders' });
    expect(sql).toContain('rls_public_customer_orders_tenant_select');
  });
});