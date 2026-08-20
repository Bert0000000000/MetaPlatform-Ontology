// supabase/functions/ack-workflow-signal/index.ts
//
// POST /functions/v1/ack-workflow-signal
//   body: { id: uuid, status: 'sent' | 'acknowledged' | 'failed', error?: string }
//   Temporal worker 调, 标记 signal 已发送 / workflow 已 ack / 失败.
//
// PoC: 不调 Temporal, 只更新 workflow_signals 表.
//   生产: worker 应先调 Temporal workflow.signal(), 成功后再调此 EF 标记 sent.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

const VALID_STATUSES = ['sent', 'acknowledged', 'failed'];

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
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'only admin/owner can ack workflow signal' }, 403);
    }

    let body: { id: string; status: string; error?: string };
    try {
      body = await req.json() as typeof body;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.id || typeof body.id !== 'string') {
      return jsonResponse({ error: 'invalid_id', message: 'id (uuid string) is required' }, 400);
    }
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return jsonResponse({ error: 'invalid_status', message: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 先查当前 row (status 应是 pending 或 sent)
    const { data: existing, error: queryErr } = await sb
      .from('workflow_signals')
      .select('id, status')
      .eq('id', body.id)
      .single();
    if (queryErr || !existing) {
      return jsonResponse({ error: 'not_found', message: 'workflow_signal not found' }, 404);
    }
    if (existing.status === 'acknowledged') {
      return jsonResponse({ error: 'already_acknowledged', message: 'signal already acknowledged' }, 409);
    }
    if (body.status === 'sent' && existing.status !== 'pending') {
      return jsonResponse({ error: 'invalid_state', message: `cannot mark sent from status '${existing.status}'` }, 409);
    }

    const update: Record<string, unknown> = { status: body.status };
    if (body.status === 'sent') update.sent_at = new Date().toISOString();
    if (body.status === 'acknowledged') update.acknowledged_at = new Date().toISOString();
    if (body.status === 'failed' && body.error) update.error = body.error;

    const { error: updateErr } = await sb.from('workflow_signals').update(update).eq('id', body.id);
    if (updateErr) {
      return jsonResponse({ error: 'update_failed', message: updateErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      id: body.id,
      status: body.status,
      updated_at: update.sent_at ?? update.acknowledged_at ?? null,
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});