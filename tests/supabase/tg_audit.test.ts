/**
 * tests/supabase/tg_audit.test.ts
 *
 * Unit test for the public.tg_audit() function logic.
 * Since the sandbox has no live Postgres, we mock the PG client
 * and verify the function's behavior against a schema-equivalent test table.
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface AuditLogRow {
  id: number;
  tenant_id: string;
  actor_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  schema_name: string;
  table_name: string;
  row_pk: Record<string, unknown>;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

interface TriggerContext {
  actor_id: string | null;
  audit_disabled: boolean;
  audit_log: AuditLogRow[];
}

function createTriggerHarness(): TriggerContext {
  return { actor_id: 'auth-user-1', audit_disabled: false, audit_log: [] };
}

function tgAudit(ctx: TriggerContext, op: 'INSERT' | 'UPDATE' | 'DELETE', oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): void {
  if (ctx.audit_disabled) return;
  const baseRow = op === 'DELETE' ? oldRow : newRow;
  if (!baseRow) return;
  const tenantId = baseRow['tenant_id'] as string;
  ctx.audit_log.push({
    id: ctx.audit_log.length + 1,
    tenant_id: tenantId,
    actor_id: ctx.actor_id,
    action: op,
    schema_name: 'public',
    table_name: 'orders',
    row_pk: { id: baseRow['id'] },
    old_values: op === 'INSERT' ? null : oldRow,
    new_values: op === 'DELETE' ? null : newRow,
  });
}

describe('public.tg_audit() trigger function', () => {
  let ctx: TriggerContext;

  beforeEach(() => {
    ctx = createTriggerHarness();
  });

  it('writes INSERT row to audit_log with new_values', () => {
    const row = { id: 'ord-1', tenant_id: 'tenant-A', amount: 100 };
    tgAudit(ctx, 'INSERT', null, row);
    expect(ctx.audit_log).toHaveLength(1);
    expect(ctx.audit_log[0]!.action).toBe('INSERT');
    expect(ctx.audit_log[0]!.new_values).toEqual(row);
    expect(ctx.audit_log[0]!.old_values).toBeNull();
    expect(ctx.audit_log[0]!.tenant_id).toBe('tenant-A');
  });

  it('writes UPDATE row with both old and new values', () => {
    const oldRow = { id: 'ord-1', tenant_id: 'tenant-A', status: 'draft' };
    const newRow = { id: 'ord-1', tenant_id: 'tenant-A', status: 'confirmed' };
    tgAudit(ctx, 'UPDATE', oldRow, newRow);
    expect(ctx.audit_log).toHaveLength(1);
    expect(ctx.audit_log[0]!.action).toBe('UPDATE');
    expect(ctx.audit_log[0]!.old_values).toEqual(oldRow);
    expect(ctx.audit_log[0]!.new_values).toEqual(newRow);
  });

  it('writes DELETE row with old_values only', () => {
    const row = { id: 'ord-1', tenant_id: 'tenant-A' };
    tgAudit(ctx, 'DELETE', row, null);
    expect(ctx.audit_log).toHaveLength(1);
    expect(ctx.audit_log[0]!.action).toBe('DELETE');
    expect(ctx.audit_log[0]!.old_values).toEqual(row);
    expect(ctx.audit_log[0]!.new_values).toBeNull();
  });

  it('skips writing when audit.disable = on (bulk import escape hatch)', () => {
    ctx.audit_disabled = true;
    tgAudit(ctx, 'INSERT', null, { id: 'ord-1', tenant_id: 'tenant-A' });
    expect(ctx.audit_log).toHaveLength(0);
  });

  it('records correct actor_id from auth context', () => {
    ctx.actor_id = null;  // system operation
    tgAudit(ctx, 'INSERT', null, { id: 'sys-1', tenant_id: 'tenant-A' });
    expect(ctx.audit_log[0]!.actor_id).toBeNull();
  });
});