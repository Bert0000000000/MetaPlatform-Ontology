// supabase/functions/dsh-session-load/index.ts
//
// POST /functions/v1/dsh-session-load
//   body: { session_id }
//   返回: { session_id, header, events: [...ordered by seq] }
//   用于: dsh-web 重启 / 新副本接管, 恢复完整 session state
//   crash recovery: events 表 source_event_seqs 提供事件依赖, 可重建 closers

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface LoadRequest {
  session_id: string;
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

    let body: LoadRequest;
    try {
      body = await req.json() as LoadRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.session_id || typeof body.session_id !== 'string') {
      return jsonResponse({ error: 'invalid_session_id', message: 'session_id required' }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 用 anon key + user JWT 让 RLS 自动按 tenant 过滤
    const userSb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } } },
    );

    const { data: header, error: headerErr } = await userSb
      .from('dsh_session_headers')
      .select('id, tenant_id, user_id, workspace_id, version, agent_preset, status, title, pending_workflow_id, created_at, updated_at, completed_at, metadata')
      .eq('id', body.session_id)
      .single();
    if (headerErr || !header) {
      return jsonResponse({ error: 'session_not_found', message: `session ${body.session_id} not found or not accessible` }, 404);
    }

    const { data: events, error: eventsErr } = await sb
      .from('dsh_session_events')
      .select('seq, type, time, data, source_event_seqs, surface_op')
      .eq('session_id', body.session_id)
      .order('seq', { ascending: true });
    if (eventsErr) {
      return jsonResponse({ error: 'query_failed', message: eventsErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      session_id: body.session_id,
      header,
      events: events ?? [],
      stats: {
        event_count: events?.length ?? 0,
        max_seq: events && events.length > 0 ? events[events.length - 1].seq : -1,
        version: header.version,
      },
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});