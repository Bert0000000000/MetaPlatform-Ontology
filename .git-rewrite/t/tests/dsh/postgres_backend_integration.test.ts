/**
 * tests/dsh/postgres_backend_integration.test.ts
 *
 * Verifies the dsh Postgres backend supports concurrent appends from multiple
 * replicas (K8s multi-pod dsh-web).
 *
 * Mocks Supabase with a Map-backed store to simulate cross-replica state.
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface EventRecord {
  session_id: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

class MockSupabase {
  headers: Array<EventRecord> = [];
  updates: Array<{ id: string; ts: string }> = [];

  from(table: string) {
    if (table === 'dsh_session_events') {
      return {
        insert: (rows: EventRecord[]) => {
          // 模拟跨副本并发: 接受所有 events, 模拟 Postgres 顺序执行
          for (const r of rows) {
            const existing = this.headers.filter((e) => e.session_id === r.session_id);
            const lastSeq = existing.length > 0 ? Math.max(...existing.map((e) => e.seq)) : 0;
            if (r.seq <= lastSeq) {
              // 模拟 ON CONFLICT 跳过 (v6 应该是 ON CONFLICT DO NOTHING 或 raise)
              continue;
            }
            this.headers.push(r);
          }
          return Promise.resolve({ data: rows, error: null });
        },
      };
    }
    if (table === 'dsh_session_headers') {
      return {
        update: (vals: { updated_at: string }) => ({
          eq: (col: string, val: string) => {
            this.updates.push({ id: val, ts: vals.updated_at });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }
    throw new Error(`Unknown table: ${table}`);
  }
}

import { DshPostgresBackend } from '../../packages/mp-dsh-postgres-backend/src/index.js';

describe('dsh Postgres backend: multi-replica concurrent append', () => {
  let backend: DshPostgresBackend;
  let mock: MockSupabase;

  beforeEach(() => {
    mock = new MockSupabase();
    // 通过依赖注入 (实际需要 backend 接受 supabase 实例; 这里用 cast)
    backend = new DshPostgresBackend({ supabaseUrl: 'http://test', supabaseKey: 'test' });
    (backend as unknown as { supabase: unknown }).supabase = mock;
  });

  it('accepts non-overlapping seq ranges from different replicas', async () => {
    // Replica 1: seq 1-3
    await backend.append('session-A', [
      { session_id: 'session-A', seq: 1, type: 'user', data: {} },
      { session_id: 'session-A', seq: 2, type: 'agent', data: {} },
      { session_id: 'session-A', seq: 3, type: 'tool', data: {} },
    ]);
    // Replica 2: seq 4-6 (并发)
    await backend.append('session-A', [
      { session_id: 'session-A', seq: 4, type: 'user', data: {} },
      { session_id: 'session-A', seq: 5, type: 'agent', data: {} },
      { session_id: 'session-A', seq: 6, type: 'tool', data: {} },
    ]);

    expect(mock.headers).toHaveLength(6);
    expect(mock.headers.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects non-contiguous seq (crash recovery detection)', async () => {
    await expect(
      backend.append('session-A', [
        { session_id: 'session-A', seq: 1, type: 'user', data: {} },
        { session_id: 'session-A', seq: 3, type: 'agent', data: {} },  // gap
      ]),
    ).rejects.toThrow(/Non-contiguous/);
  });

  it('updates header updated_at on every append', async () => {
    await backend.append('session-A', [
      { session_id: 'session-A', seq: 1, type: 'user', data: {} },
    ]);
    await backend.append('session-A', [
      { session_id: 'session-A', seq: 2, type: 'agent', data: {} },
    ]);

    expect(mock.updates).toHaveLength(2);
    expect(mock.updates[0]?.id).toBe('session-A');
    expect(mock.updates[1]?.id).toBe('session-A');
  });
});