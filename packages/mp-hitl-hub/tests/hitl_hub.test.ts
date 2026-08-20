/**
 * packages/mp-hitl-hub/tests/hitl_hub.test.ts
 *
 * Verifies HITL Hub request + decide flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HitlHub, type HitlRecord } from '../src/index.js';

interface MockRow {
  id: string;
  tenant_id: string;
  type: string;
  status: string;
  title: string;
  context: Record<string, unknown>;
  approver_user_ids: string[];
  timeout_at: string;
  workflow_id: string | null;
  escalation_level: number;
  decided_at: string | null;
  decided_by: string | null;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

class MockSupabase {
  rows: MockRow[] = [];
  broadcasts: Array<{ channel: string; event: string; payload: unknown }> = [];

  from(table: string) {
    if (table === 'hitl_requests') {
      return {
        insert: (rows: MockRow[]) => {
          const r = rows[0]!;
          const full: MockRow = {
            ...r,
            id: r.id ?? `hitl-${Math.random().toString(36).slice(2, 10)}`,
            status: r.status ?? 'pending',
            escalation_level: r.escalation_level ?? 0,
            decided_at: null,
            decided_by: null,
            decision_payload: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          this.rows.push(full);
          const single = () => Promise.resolve({ data: full, error: null });
          const select = () => ({ single });
          const builder: MockRow[] & { select: () => { single: () => Promise<{ data: MockRow; error: null }> } } = Object.assign([full], { select });
          return Promise.resolve(builder);
        },
        select: () => ({
          single: () => {
            const r = this.rows[0];
            return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'not found' } });
          },
        }),
        update: (vals: Partial<MockRow>) => ({
          eq: (col: string, val: string) => {
            const row = this.rows.find((r) => r.id === val);
            if (row) Object.assign(row, vals);
            const single = () => Promise.resolve({ data: row ?? null, error: null });
            const builder = Object.assign([row], { single });
            return Promise.resolve(builder);
          },
        }),
        eq: (col: string, val: string) => {
          const row = this.rows.find((r) => r.id === val);
          const single = () => Promise.resolve({ data: row ?? null, error: null });
          const builder = Object.assign([row], { single });
          return Promise.resolve(builder);
        },
      };
    }
    throw new Error(`Unknown table: ${table}`);
  }

  channel(name: string) {
    return {
      send: (msg: { type: string; event: string; payload: unknown }) => {
        this.broadcasts.push({ channel: name, ...msg });
        return Promise.resolve('ok');
      },
    };
  }
}

describe('HITL Hub', () => {
  let hub: HitlHub;
  let mock: MockSupabase;

  beforeEach(() => {
    mock = new MockSupabase();
    hub = new HitlHub({ supabaseUrl: 'http://test', supabaseKey: 'test' });
    (hub as unknown as { supabase: unknown }).supabase = mock;
  });

  it('requestHitl creates pending record + broadcasts', async () => {
    const record = await hub.requestHitl({
      tenantId: 'tenant-A',
      type: 'workflow_saas',
      title: '审批合同',
      context: { contract_id: 'contract-1' },
      approverUserIds: ['user-1'],
      timeoutAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      workflowId: 'wf-1',
    });

    expect(record.status).toBe('pending');
    expect(record.type).toBe('workflow_saas');
    expect(mock.broadcasts).toHaveLength(1);
    expect(mock.broadcasts[0]?.event).toBe('hitl_request_created');
    expect(mock.broadcasts[0]?.channel).toBe('hitl:tenant-A');
  });

  it('rejects timeout > 7 days', async () => {
    await expect(
      hub.requestHitl({
        tenantId: 'tenant-A',
        type: 'workflow_saas',
        title: 'Test',
        context: {},
        approverUserIds: ['user-1'],
        timeoutAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),  // 8 天
      }),
    ).rejects.toThrow(/7-day limit/);
  });

  it('decideHitl updates status + broadcasts decision', async () => {
    const created = await hub.requestHitl({
      tenantId: 'tenant-B',
      type: 'workflow_dsh',
      title: '审批',
      context: {},
      approverUserIds: ['user-2'],
      timeoutAt: new Date(Date.now() + 60 * 60 * 1000),
      workflowId: 'wf-2',
    });

    const decided = await hub.decideHitl({
      hitlRequestId: created.id,
      decision: 'approved',
      decidedBy: 'user-2',
      comment: 'OK',
    });

    expect(decided.status).toBe('approved');
    expect(decided.decided_by).toBe('user-2');
    expect(decided.decision_payload).toEqual({ comment: 'OK' });
    expect(mock.broadcasts).toHaveLength(2);
    expect(mock.broadcasts[1]?.event).toBe('hitl_decision_made');
  });

  it('rejects double decide', async () => {
    const created = await hub.requestHitl({
      tenantId: 'tenant-A',
      type: 'tool_dsh',
      title: '敏感 tool',
      context: {},
      approverUserIds: ['user-1'],
      timeoutAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await hub.decideHitl({ hitlRequestId: created.id, decision: 'approved', decidedBy: 'user-1' });
    await expect(
      hub.decideHitl({ hitlRequestId: created.id, decision: 'rejected', decidedBy: 'user-2' }),
    ).rejects.toThrow(/already decided/);
  });
});