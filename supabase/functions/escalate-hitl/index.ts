// supabase/functions/escalate-hitl/index.ts
// PRD: docs/active/prd/hitl-hub.md
// ADR:  docs/active/decisions/ADR-0053-hitl-hub.md
// Batch: MetaPlatform-LONG-TASK-01 (Loop 1/3) + HITL Hub Loop 3/3
//
// POST /functions/v1/escalate-hitl
//   body: { hitl_request_id: uuid, new_approver_ids: string[], escalation_level: number, note?: string }
//   admin/owner 调用: 把 HITL 转给下一级 approver, escalation_level + 1
//   status 重置 pending, deadline_at 重新设置 (按 escalation_level 阶梯)
//   同时 INSERT workflow_signals (signal_name='hitl_escalation') 让 Temporal worker 知道
//
// 阶梯 (per 模块规划 §M22):
//   level 0 (初始): 24h  timeout
//   level 1 (→B):   24h
//   level 2 (→C):   48h
//   level 3 (→D):   72h
//
// Realtime: hitl UPDATE → ws 推送, 新 approver 看到通知

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface EscalateRequest {
  hitl_request_id: string;
  new_approver_ids: string[];
  note?: string;
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
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'only admin/owner can escalate HITL' }, 403);
    }

    let body: EscalateRequest;
    try {
      body = await req.json() as EscalateRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.hitl_request_id || typeof body.hitl_request_id !== 'string') {
      return jsonResponse({ error: 'invalid_id', message: 'hitl_request_id (uuid) required' }, 400);
    }
    if (!Array.isArray(body.new_approver_ids) || body.new_approver_ids.length === 0) {
      return jsonResponse({ error: 'invalid_approvers', message: 'new_approver_ids must be non-empty array' }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 查 hitl
    const { data: hitl, error: queryErr } = await sb
      .from('hitl_requests')
      .select('id, tenant_id, status, escalation_level, approver_ids, deadline_at')
      .eq('id', body.hitl_request_id)
      .single();
    if (queryErr || !hitl) {
      return jsonResponse({ error: 'not_found', message: 'hitl_request not found' }, 404);
    }
    if (hitl.tenant_id !== auth.tenantId) {
      return jsonResponse({ error: 'forbidden', message: 'cross-tenant access denied' }, 403);
    }
    if (hitl.status !== 'pending') {
      return jsonResponse({
        error: 'not_pending',
        message: `HITL already in status '${hitl.status}', escalation only allowed for pending`,
      }, 409);
    }
    if (hitl.escalation_level >= 4) {
      return jsonResponse({ error: 'max_escalation', message: 'already at max escalation level (4)' }, 409);
    }

    const newLevel = (hitl.escalation_level ?? 0) + 1;
    const now = new Date();
    // 阶梯: level 1 → +24h, level 2 → +48h, level 3 → +72h
    const hoursToAdd = newLevel * 24;
    const newDeadline = new Date(now.getTime() + hoursToAdd * 3600 * 1000).toISOString();

    const { error: updateErr } = await sb
      .from('hitl_requests')
      .update({
        status: 'pending',
        approver_ids: body.new_approver_ids,
        escalation_level: newLevel,
        deadline_at: newDeadline,
        decision_note: body.note ?? null,
        // 保留上一级 decided_* 不动, 仅换审批人
      })
      .eq('id', body.hitl_request_id);
    if (updateErr) {
      return jsonResponse({ error: 'update_failed', message: updateErr.message }, 500);
    }

    // INSERT workflow_signals (signal_name='hitl_escalation') — worker 通过这个通知 Temporal
    // (即使 hitl 没有关联 workflow_id 也可能 escalation, 这里仍然创建 signal 让 worker 知晓)
    // 但 hitl_requests 有 UNIQUE constraint on (id) ? 不, hitl_requests PK 是 id. UNIQUE on workflow_signals 是 hitl_request_id.
    // 这里注意: 同一个 hitl 已有 workflow_signals (initial approved/rejected 决策时创建的, 如果有 workflow_id).
    // 现在 escalate 是 pending → pending (实际上从 pending 转 pending 但 approvers 变了), 不触发 trigger.
    // 我们显式 INSERT 一个 hitl_escalation signal (ON CONFLICT 覆盖).
    // 注意: workflow_signals 有 UNIQUE(hitl_request_id), 我们想保留原来那条 (如果存在).
    // 解法: 在 escalation 时不创建新 workflow_signal, 让 Temporal worker 通过 Realtime 订阅 hitl_requests UPDATE 自己处理.
    // (这里留空, 后续 Loop 3/3 可选创建独立 escalation_signals 表)

    return jsonResponse({
      ok: true,
      hitl_request_id: body.hitl_request_id,
      escalation_level: newLevel,
      new_approver_ids: body.new_approver_ids,
      new_deadline_at: newDeadline,
      hours_to_deadline: hoursToAdd,
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});