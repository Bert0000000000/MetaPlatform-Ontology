import { describe, it, expect } from 'vitest';
import { DshPostgresBackend } from '../src/index.js';

// Mock SupabaseClient for testing (real client requires live DB)
const mockSupabase = {
  from: (table: string) => ({
    insert: (rows: unknown[]) => {
      const r = { data: rows, error: null };
      return Promise.resolve(r);
    },
    select: (cols: string) => {
      const r = { data: [], error: null };
      return Promise.resolve(r);
    },
    update: (vals: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        const r = { data: null, error: null };
        return Promise.resolve(r);
      },
    }),
    eq: (col: string, val: string) => {
      const r = { data: null, error: null };
      return Promise.resolve(r);
    },
    order: (col: string, opts: { ascending: boolean }) => {
      const r = { data: [], error: null };
      return Promise.resolve(r);
    },
    limit: (n: number) => {
      const r = { data: [], error: null };
      return Promise.resolve(r);
    },
    single: () => {
      const r = { data: null, error: null };
      return Promise.resolve(r);
    },
  }),
};

const mockBackend = new DshPostgresBackend({
  supabaseUrl: 'http://localhost',
  supabaseKey: 'test',
});

describe('DshPostgresBackend.append', () => {
  it('throws on non-contiguous seq', async () => {
    const sessionId = 'sess-1';
    const events = [
      { session_id: sessionId, seq: 1, type: 'user_message', time: '2026-08-20T00:00:00Z', data: {} as Record<string, unknown>, source_event_seqs: null, surface_op: null },
      { session_id: sessionId, seq: 3, type: 'agent_message', time: '2026-08-20T00:01:00Z', data: {} as Record<string, unknown>, source_event_seqs: null, surface_op: null },
    ];
    await expect(mockBackend.append(sessionId, events)).rejects.toThrow(/Non-contiguous/);
  });

  it('accepts contiguous seq', async () => {
    const sessionId = 'sess-1';
    const events = [
      { session_id: sessionId, seq: 1, type: 'user_message', time: '2026-08-20T00:00:00Z', data: {} as Record<string, unknown>, source_event_seqs: null, surface_op: null },
      { session_id: sessionId, seq: 2, type: 'agent_message', time: '2026-08-20T00:01:00Z', data: {} as Record<string, unknown>, source_event_seqs: null, surface_op: null },
    ];
    await expect(mockBackend.append(sessionId, events)).resolves.toBeUndefined();
  });

  it('no-op on empty events', async () => {
    await expect(mockBackend.append('sess-1', [])).resolves.toBeUndefined();
  });
});