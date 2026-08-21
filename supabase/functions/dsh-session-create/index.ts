// supabase/functions/dsh-session-create/index.ts
//
// POST /functions/v1/dsh-session-create
//   body: { agent_preset, workspace_id?, origin?, metadata? }
//   dsh-web K8s 多副本调用: 创建 session header (返回 id), dsh agent 后续写 events
//
// 返回: { session_id, version: 0, created_at }
// 后续: dsh-session-append-events + dsh-session-load

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface CreateRequest {
  agent_preset?: string;
  workspace_id?: string;
  origin?: string;
  delegation_depth?: number;
  metadata?: Record<string, unknown>;
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

    let body: CreateRequest;
    try {
      body = await req.json() as CreateRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await sb.from('dsh_session_headers').insert({
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      agent_preset: body.agent_preset ?? 'mp-v6-master',
      workspace_id: body.workspace_id ?? null,
      origin: body.origin ?? 'web',
      delegation_depth: body.delegation_depth ?? 0,
      status: 'running',
      metadata: body.metadata ?? {},
    }).select().single();

    if (error || !data) {
      return jsonResponse({ error: 'insert_failed', message: error?.message ?? 'unknown' }, 500);
    }

    return jsonResponse({
      ok: true,
      session_id: data.id,
      version: data.version,
      status: data.status,
      created_at: data.created_at,
    }, 201);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});