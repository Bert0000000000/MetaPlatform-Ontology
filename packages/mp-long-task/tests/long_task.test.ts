/**
 * packages/mp-long-task/tests/long_task.test.ts
 *
 * Verifies LongTaskClient.create() validation + escalation chain.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LongTaskClient, type EscalationChain } from '../src/index.js';

class MockSupabase {
  hitlRequests: Array<Record<string, unknown>> = [];
  chains: Array<Record<string, unknown>> = [];

  from(table: string) {
    if (table === 'hitl_requests') {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          const r = rows[0]!;
          const id = `hr-${this.hitlRequests.length + 1}`;
          const full = {
            id,
            ...r,
            status: r['status'] ?? 'pending',
            escalation_level: r['escalation_level'] ?? 0,
          };
          this.hitlRequests.push(full);
          const single = () => Promise.resolve({ data: full, error: null });
          const builder = Object.assign([full], { single });
          return Promise.resolve(builder);
        },
      };
    }
    if (table === 'tenant_escalation_chain') {
      return {
        upsert: (rows: Array<Record<string, unknown>>) => {
          for (const r of rows) this.chains.push(r);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`unknown table: ${table}`);
  }
}

describe('LongTaskClient.create', () => {
  let mock: MockSupabase;
  let client: LongTaskClient;

  beforeEach(() => {
    mock = new MockSupabase();
    client = new LongTaskClient({ supabaseUrl: 'http://test', supabaseKey: 'test' });
    (client as unknown as { supabase: unknown }).supabase = mock;
  });

  it('creates a level-0 long task with initial approvers', async () => {
    const escalation: EscalationChain = {
      levels: [
        { level: 0, approverUserIds: ['mgr-1'], timeoutHours: 24 },
        { level: 1, approverUserIds: ['dir-1'], timeoutHours: 48 },
        { level: 2, approverUserIds: ['vp-1'], timeoutHours: 72 },
      ],
      finalAction: 'expire',
    };

    const result = await client.create({
      tenantId: 'tenant-A',
      type: 'workflow_saas',
      title: '审批合同',
      context: { contract_id: 'c-1', amount: 150000 },
      initialApprovers: ['mgr-1'],
      totalTimeoutMs: 7 * 24 * 60 * 60 * 1000,
      escalation,
    });

    expect(result.status).toBe('pending');
    expect(result.currentLevel).toBe(0);
    expect(result.hitlRequestId).toBe('hr-1');
    expect(mock.hitlRequests).toHaveLength(1);
    expect(mock.chains).toHaveLength(3);  // 3 levels saved
  });

  it('rejects when escalation total hours exceed totalTimeoutMs', async () => {
    const escalation: EscalationChain = {
      levels: [
        { level: 0, approverUserIds: ['a'], timeoutHours: 24 },
        { level: 1, approverUserIds: ['b'], timeoutHours: 48 },
        { level: 2, approverUserIds: ['c'], timeoutHours: 200 },  // 总和 = 272h
      ],
      finalAction: 'expire',
    };

    await expect(
      client.create({
        tenantId: 'tenant-A',
        type: 'workflow_saas',
        title: 'Test',
        context: {},
        initialApprovers: ['a'],
        totalTimeoutMs: 7 * 24 * 60 * 60 * 1000,  // 168h
        escalation,
      }),
    ).rejects.toThrow(/exceeds totalTimeoutMs/);
  });

  it('rejects empty escalation chain', async () => {
    await expect(
      client.create({
        tenantId: 'tenant-A',
        type: 'workflow_saas',
        title: 'Test',
        context: {},
        initialApprovers: [],
        totalTimeoutMs: 1000,
        escalation: { levels: [], finalAction: 'expire' },
      }),
    ).rejects.toThrow(/empty/);
  });
});