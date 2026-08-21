// supabase/functions/dsh-session-append-events/index.ts
//
// POST /functions/v1/dsh-session-append-events
//   body: { session_id, events: [{ seq, type, data, source_event_seqs?, surface_op? }] }
//   dsh agent loop 调用: append 一批 events (有序 seq)
//   校验: seq 必须 contiguous (last_seq + 1, +2, ...)
//   校验: source_event_seqs 引用必须存在
//
// 后续: dsh-session-load 重放 seq ordering + crash recovery

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface Event {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  source_event_seqs?: number[];
  surface_op?: 'append' | 'rewrite' | 'compact';
  time?: string;
}

interface AppendRequest {
  session_id: string;
  events: Event[];
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'POST only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);

    let body: AppendRequest;
    try {
      body = await req.json() as AppendRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.session_id || typeof body.session_id !== 'string') {
      return jsonResponse({ error: 'invalid_session_id', message: 'session_id required' }, 400);
    }
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return jsonResponse({ error: 'invalid_events', message: 'events must be non-empty array' }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 查 session header + tenant check + last_seq
    const { data: header, error: headerErr } = await sb
      .from('dsh_session_headers')
      .select('id, tenant_id, version')
      .eq('id', body.session_id)
      .single();
    if (headerErr || !header) {
      return jsonResponse({ error: 'session_not_found', message: `session ${body.session_id} not found` }, 404);
    }
    if (header.tenant_id !== auth.tenantId) {
      return jsonResponse({ error: 'forbidden', message: 'cross-tenant access denied' }, 403);
    }

    const { data: lastEvent, error: lastErr } = await sb
      .from('dsh_session_events')
      .select('seq')
      .eq('session_id', body.session_id)
      .order('seq', { ascending: false })
      .limit(1);
    if (lastErr) {
      return jsonResponse({ error: 'query_failed', message: lastErr.message }, 500);
    }
    const lastSeq = lastEvent && lastEvent.length > 0 ? (lastEvent[0] as { seq: number }).seq : -1;

    // 校验 seq contiguous
    const rows = body.events.map((e) => ({
      session_id: body.session_id,
      seq: e.seq,
      type: e.type,
      data: e.data,
      source_event_seqs: e.source_event_seqs ?? [],
      surface_op: e.surface_op ?? 'append',
      time: e.time ?? new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].seq !== lastSeq + 1 + i) {
        return jsonResponse({
          error: 'seq_not_contiguous',
          message: `expected seq ${lastSeq + 1 + i}, got ${rows[i].seq}`,
          expected_next_seq: lastSeq + 1,
        }, 409);
      }
    }

    // batch INSERT
    const { error: insertErr, count } = await sb
      .from('dsh_session_events')
      .insert(rows);
    if (insertErr) {
      return jsonResponse({ error: 'insert_failed', message: insertErr.message }, 500);
    }

    // update header version + updated_at
    await sb
      .from('dsh_session_headers')
      .update({ version: (header.version ?? 0) + 1 })
      .eq('id', body.session_id);

    // next_seq = max seq in inserted batch + 1 (since batch is contiguous starting at lastSeq+1)
    const maxSeq = Math.max(...rows.map((r) => r.seq));
    return jsonResponse({
      ok: true,
      session_id: body.session_id,
      appended: rows.length,
      next_seq: maxSeq + 1,
      version: (header.version ?? 0) + 1,
    }, 201);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});