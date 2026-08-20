/**
 * tests/hitl/hitl_requests.test.ts
 *
 * Verifies hitl_requests RLS policies + 4-type enum.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG_PATH = join(process.cwd(), 'supabase/migrations/20260820140100_create_hitl_requests_table.sql');

describe('hitl_requests table (20260820140100_create_hitl_requests_table.sql)', () => {
  const content = readFileSync(MIG_PATH, 'utf8');

  it('declares 4 HITL types', () => {
    expect(content).toMatch(/workflow_saas/);
    expect(content).toMatch(/workflow_dsh/);
    expect(content).toMatch(/tool_dsh/);
    expect(content).toMatch(/action_confirm/);
  });

  it('declares 5 statuses (pending/approved/rejected/expired/cancelled)', () => {
    for (const status of ['pending', 'approved', 'rejected', 'expired', 'cancelled']) {
      expect(content).toContain(status);
    }
  });

  it('has RLS enabled', () => {
    expect(content).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('applies all 4 RLS policy templates', () => {
    expect(content).toMatch(/_policy_tenant_select/);
    expect(content).toMatch(/_policy_tenant_insert/);
    expect(content).toMatch(/_policy_tenant_update/);
    expect(content).toMatch(/_policy_tenant_delete/);
  });

  it('has tg_inject_tenant + tg_audit triggers', () => {
    expect(content).toMatch(/tg_inject_tenant/);
    expect(content).toMatch(/tg_audit/);
  });

  it('supports workflow_id + escalation_level + parent_request_id (升级链)', () => {
    expect(content).toMatch(/workflow_id/);
    expect(content).toMatch(/escalation_level/);
    expect(content).toMatch(/parent_request_id/);
  });

  it('indexes for timeout_at-based polling (long_task §5)', () => {
    expect(content).toMatch(/timeout_at.*WHERE.*status.*pending/);
  });
});