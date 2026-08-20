/**
 * packages/mp-dsh-postgres-backend/src/index.ts
 * PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.14 (⭐ dsh Postgres backend)
 *
 * 自建 dsh session persistence backend, 复用 Supabase Postgres.
 * 替代 dsh 官方 JSONL / SQLite backend (K8s 多副本不共享).
 *
 * 实现 `@deepseek-ai/dsh-session-persistence` Service Definition:
 *   - append(id, events): 批量 INSERT, 校验 contiguous seq
 *   - load(id): JOIN header + events, 按 seq 排序, crash recovery
 *   - list(): 从 headers 列表
 *   - listSnapshots(): 轻量列表 (仅 header)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DshSessionHeader {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly version: number;
  readonly cwd: string | null;
  readonly parent_session: string | null;
  readonly seed_length: number | null;
  readonly origin: string | null;
  readonly delegation_depth: number;
  readonly agent_preset: string | null;
  readonly status: 'running' | 'waiting_tool' | 'waiting_hitl' | 'waiting_external' | 'completed';
  readonly pending_workflow_id: string | null;
  readonly pending_tool_call_id: string | null;
  readonly pending_tool_call_result: Record<string, unknown> | null;
  readonly title: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

export interface DshSessionEvent {
  readonly session_id: string;
  readonly seq: number;
  readonly type: string;
  readonly time: string;
  readonly data: Record<string, unknown>;
  readonly source_event_seqs: string[] | null;
  readonly surface_op: string | null;
}

export class DshPostgresBackend {
  private readonly supabase: SupabaseClient;
  private readonly schema: string;

  constructor(opts: { supabaseUrl: string; supabaseKey: string; schema?: string }) {
    this.supabase = createClient(opts.supabaseUrl, opts.supabaseKey, {
      db: { schema: opts.schema ?? 'public' },
    });
    this.schema = opts.schema ?? 'public';
  }

  /**
   * 批量 append events; 校验 contiguous seq (crash recovery)
   */
  async append(sessionId: string, events: ReadonlyArray<DshSessionEvent>): Promise<void> {
    if (events.length === 0) return;

    // 按 seq 排序, 校验连续性
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      if (curr.seq !== prev.seq + 1) {
        throw new Error(`Non-contiguous seq at ${curr.seq} (expected ${prev.seq + 1})`);
      }
    }

    const { error } = await this.supabase
      .from('dsh_session_events')
      .insert(sorted.map((e) => ({
        session_id: e.session_id,
        seq: e.seq,
        type: e.type,
        time: e.time,
        data: e.data,
        source_event_seqs: e.source_event_seqs,
        surface_op: e.surface_op,
      })));

    if (error) throw new Error(`append failed: ${error.message}`);

    // 更新 header updated_at
    await this.supabase
      .from('dsh_session_headers')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  /**
   * load session + events (按 seq 排序)
   */
  async load(sessionId: string): Promise<{ header: DshSessionHeader; events: DshSessionEvent[] } | null> {
    const { data: h, error: hErr } = await this.supabase
      .from('dsh_session_headers')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (hErr || !h) return null;

    const { data: e, error: eErr } = await this.supabase
      .from('dsh_session_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('seq', { ascending: true });

    if (eErr) throw new Error(`load events failed: ${eErr.message}`);

    return { header: h as DshSessionHeader, events: (e ?? []) as DshSessionEvent[] };
  }

  async list(opts?: { tenantId?: string; limit?: number }): Promise<DshSessionHeader[]> {
    let query = this.supabase
      .from('dsh_session_headers')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(opts?.limit ?? 100);

    if (opts?.tenantId) {
      query = query.eq('tenant_id', opts.tenantId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`list failed: ${error.message}`);
    return (data ?? []) as DshSessionHeader[];
  }

  async listSnapshots(): Promise<ReadonlyArray<Pick<DshSessionHeader, 'id' | 'tenant_id' | 'status' | 'updated_at'>>> {
    const { data, error } = await this.supabase
      .from('dsh_session_headers')
      .select('id,tenant_id,status,updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw new Error(`listSnapshots failed: ${error.message}`);
    return (data ?? []) as Array<Pick<DshSessionHeader, 'id' | 'tenant_id' | 'status' | 'updated_at'>>;
  }

  async markCompleted(sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('dsh_session_headers')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) throw new Error(`markCompleted failed: ${error.message}`);
  }
}

export default DshPostgresBackend;