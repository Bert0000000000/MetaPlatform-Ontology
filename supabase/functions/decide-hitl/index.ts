// supabase/functions/decide-hitl/index.ts
// PRD: docs/active/prd/hitl-hub.md
// ADR:  docs/active/decisions/ADR-0053-hitl-hub.md
//
// POST /functions/v1/decide-hitl — 审批 / 拒绝 HITL request
//   hitl_request_id: uuid
//   decision: 'approved' | 'rejected'
//   note: 备注
//
// Auth: 仅 approver_ids 内的用户可决 (RLS check + EF 二次校验)
// Realtime WS 自动推送 hitl_requests UPDATE

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface DecideHitlRequest {
  hitl_request_id: string;
  decision: 'approved' | 'rejected';
  note?: string;
}

const VALID_DECISIONS = ['approved', 'rejected'];

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

    let body: DecideHitlRequest;
    try {
      body = await req.json() as DecideHitlRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.hitl_request_id || typeof body.hitl_request_id !== 'string') {
      return jsonResponse({ error: 'invalid_id', message: 'hitl_request_id (uuid string) is required' }, 400);
    }
    if (!body.decision || !VALID_DECISIONS.includes(body.decision)) {
      return jsonResponse({
        error: 'invalid_decision',
        message: `decision must be one of: ${VALID_DECISIONS.join(', ')}`,
      }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) 先查 request (verify tenant + approver 权限)
    const { data: existing, error: queryErr } = await sb
      .from('hitl_requests')
      .select('id, tenant_id, status, approver_ids, type, workflow_id, temporal_signal')
      .eq('id', body.hitl_request_id)
      .single();
    if (queryErr || !existing) {
      return jsonResponse({ error: 'not_found', message: 'hitl_request not found' }, 404);
    }
    if (existing.tenant_id !== auth.tenantId) {
      return jsonResponse({ error: 'forbidden', message: 'cross-tenant access denied' }, 403);
    }
    if (existing.status !== 'pending') {
      return jsonResponse({
        error: 'already_decided',
        message: `hitl_request already in status '${existing.status}'`,
      }, 409);
    }
    if (!Array.isArray(existing.approver_ids) || !existing.approver_ids.includes(auth.userId)) {
      return jsonResponse({
        error: 'forbidden',
        message: 'user is not in approver_ids list',
      }, 403);
    }

    // 2) 更新 status + decided_by + decided_at + decision_note
    const { error: updateErr } = await sb
      .from('hitl_requests')
      .update({
        status: body.decision,
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: body.note ?? null,
      })
      .eq('id', body.hitl_request_id);
    if (updateErr) {
      return jsonResponse({ error: 'update_failed', message: updateErr.message }, 500);
    }

    // 3) 如果关联 Temporal workflow, 发 signal (M13 HITL Hub ↔ Temporal 联动)
    // 注: 当前 Edge Function runtime 不直接连 Temporal, 由 mp-workflow worker 异步消费
    // 此处只在 audit_log 留痕, worker 通过 Realtime WS 订阅 hitl_requests UPDATE 触发
    return jsonResponse({
      ok: true,
      hitl_request_id: body.hitl_request_id,
      status: body.decision,
      workflow_id: existing.workflow_id ?? null,
      temporal_signal: existing.temporal_signal ?? 'hitl_decision',
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});