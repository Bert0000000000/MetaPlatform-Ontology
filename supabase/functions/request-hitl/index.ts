// supabase/functions/request-hitl/index.ts
// PRD: docs/active/prd/hitl-hub.md
// ADR:  docs/active/decisions/ADR-0053-hitl-hub.md
// Batch: MetaPlatform-HITL-HUB-01 (Loop 1/3)
//
// POST /functions/v1/request-hitl — 4 类型 HITL 通用创建入口
//   type: workflow_saas | workflow_dsh | tool_dsh | action_confirm
//   payload: { workflow_id?, tool_call?, preview? } (类型相关)
//   approver_ids: 谁有权审批
//   deadline_at: 长任务超时时间 (M22 多级审批升级用)
//
// Realtime WS 自动推送 hitl_requests INSERT

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

type HitlType = 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_confirm';

interface RequestHitlRequest {
  type: HitlType;
  title: string;
  description?: string;
  approver_ids: string[];
  payload?: Record<string, unknown>;
  workflow_id?: string;
  temporal_signal?: string;
  deadline_at?: string;
  escalation_level?: number;
}

const VALID_TYPES: HitlType[] = ['workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm'];

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

    let body: RequestHitlRequest;
    try {
      body = await req.json() as RequestHitlRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    // validation
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return jsonResponse({
        error: 'invalid_type',
        message: `type must be one of: ${VALID_TYPES.join(', ')}`,
      }, 400);
    }
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      return jsonResponse({ error: 'invalid_title', message: 'title (string) is required' }, 400);
    }
    if (!Array.isArray(body.approver_ids) || body.approver_ids.length === 0) {
      return jsonResponse({
        error: 'invalid_approvers',
        message: 'approver_ids must be a non-empty array of uuid strings',
      }, 400);
    }
    if (body.deadline_at !== undefined) {
      const d = new Date(body.deadline_at);
      if (Number.isNaN(d.getTime())) {
        return jsonResponse({ error: 'invalid_deadline', message: 'deadline_at must be ISO timestamp' }, 400);
      }
    }

    // 创建 HITL request
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await sb.from('hitl_requests').insert({
      tenant_id: auth.tenantId,
      type: body.type,
      status: 'pending',
      title: body.title,
      description: body.description ?? null,
      requester_id: auth.userId,
      approver_ids: body.approver_ids,
      payload: body.payload ?? {},
      workflow_id: body.workflow_id ?? null,
      temporal_signal: body.temporal_signal ?? 'hitl_decision',
      deadline_at: body.deadline_at ?? null,
      escalation_level: body.escalation_level ?? 0,
    }).select().single();

    if (error || !data) {
      return jsonResponse({ error: 'insert_failed', message: error?.message ?? 'unknown' }, 500);
    }

    return jsonResponse({
      ok: true,
      hitl_request_id: data.id,
      status: data.status,
      created_at: data.created_at,
    }, 201);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});