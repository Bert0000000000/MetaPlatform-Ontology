// supabase/functions/action-apply/index.ts
// PRD:  docs/active/prd/mp-ontology.md (M12 ActionType.apply + HITL 三模式)
// ADR:   docs/active/decisions/ADR-0056-ontology-generation.md (ontology + workflow)
// Batch: MetaPlatform-EDGE-FN-01 (Loop 1/3 — M12 ActionType.apply)
//
// POST /functions/v1/action-apply
//   body: {
//     action_rid: string,
//     target_id?: string,           // target 实例 ID (e.g. customer uuid)
//     params: Record<string, unknown>,
//     mode: 'preview' | 'confirmed'
//   }
//
// 三模式 (per ADR-0053 §6.4):
//   - 'preview': 仅返回 preview payload, INSERT hitl_requests (action_confirm)
//                 用户在 dsh Web 弹窗确认后再调 mode='confirmed'
//   - 'confirmed': 启动 Temporal workflow (生产) + INSERT workflow_signals
//                 本地 dev 无 Temporal, mock 返回 "workflow_started: true"
//                 等 Loop 3/3 接入 Temporal worker 后替换 mock
//
// 权限校验: caller role 必须 >= ontology_action_types.permission
//   admin > owner > member > guest

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

type ActionMode = 'preview' | 'confirmed';
type PermissionLevel = 'admin' | 'owner' | 'member' | 'guest';

const PERMISSION_RANK: Record<PermissionLevel, number> = { admin: 3, owner: 2, member: 1, guest: 0 };

interface ApplyRequest {
  action_rid: string;
  target_id?: string;
  params?: Record<string, unknown>;
  mode: ActionMode;
}

interface ActionType {
  id: string;
  rid: string;
  name: string;
  target_type: string;
  parameters: Record<string, unknown>;
  permission: PermissionLevel;
  workflow_name: string | null;
  hitl_type: string | null;
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

    let body: ApplyRequest;
    try {
      body = await req.json() as ApplyRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }
    if (!body.action_rid || typeof body.action_rid !== 'string') {
      return jsonResponse({ error: 'invalid_action_rid', message: 'action_rid required' }, 400);
    }
    if (!body.mode || !['preview', 'confirmed'].includes(body.mode)) {
      return jsonResponse({ error: 'invalid_mode', message: "mode must be 'preview' or 'confirmed'" }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 查 action (用 anon key + user JWT 让 RLS 生效 — admin/owner 可读全部, member 仅读 active)
    const userSb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } } },
    );
    const { data: actionRows, error: actionErr } = await userSb
      .from('ontology_action_types')
      .select('id, rid, name, target_type, parameters, permission, workflow_name, hitl_type')
      .eq('rid', body.action_rid)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    if (actionErr) {
      return jsonResponse({ error: 'query_failed', message: actionErr.message }, 500);
    }
    const action = actionRows && actionRows.length > 0 ? (actionRows[0] as ActionType) : null;
    if (!action) {
      return jsonResponse({ error: 'not_found', message: `action '${body.action_rid}' not found or not active` }, 404);
    }

    // 权限校验: caller role >= action.permission
    if (PERMISSION_RANK[auth.role] < PERMISSION_RANK[action.permission]) {
      return jsonResponse({
        error: 'forbidden',
        message: `action requires ${action.permission} role, got ${auth.role}`,
      }, 403);
    }

    const params = body.params ?? {};

    if (body.mode === 'preview') {
      // 写 action_confirm HITL (让用户在 dsh Web 弹窗确认)
      const { data: hitl, error: hitlErr } = await sb.from('hitl_requests').insert({
        tenant_id: auth.tenantId,
        type: 'action_confirm',
        status: 'pending',
        title: `确认执行: ${action.name}${body.target_id ? ` (${body.target_id})` : ''}`,
        description: `Action '${action.rid}' 待确认. Caller: ${auth.userId}.`,
        requester_id: auth.userId,
        approver_ids: [auth.userId],
        payload: {
          action_rid: action.rid,
          action_id: action.id,
          target_id: body.target_id ?? null,
          params,
          workflow_name: action.workflow_name,
        },
        workflow_id: null,  // preview 阶段不关联 workflow
      }).select().single();
      if (hitlErr || !hitl) {
        return jsonResponse({ error: 'preview_failed', message: hitlErr?.message ?? 'unknown' }, 500);
      }

      return jsonResponse({
        ok: true,
        mode: 'preview',
        action_rid: action.rid,
        action_name: action.name,
        target_type: action.target_type,
        hitl_request_id: hitl.id,
        preview: {
          action_rid: action.rid,
          target_id: body.target_id ?? null,
          params,
          workflow_name: action.workflow_name,
          hitl_type: action.hitl_type,
        },
        message: 'preview OK. 用户在 dsh Web 弹窗确认后再调 mode=confirmed.',
      }, 200);
    }

    // mode='confirmed': 启动 Temporal workflow (mock for now)
    const workflowId = `${action.workflow_name ?? 'ActionWorkflow'}:${action.rid}-${Date.now()}`;

    // 模拟 Temporal workflow 启动: 写 workflow_signals 让 worker (生产) 处理
    const { data: hitlConfirm, error: hitlConfirmErr } = await sb.from('hitl_requests').insert({
      tenant_id: auth.tenantId,
      type: 'action_confirm',
      status: 'approved',  // confirmed 模式直接 approved (用户已在 dsh Web 确认过)
      title: `已确认执行: ${action.name}`,
      requester_id: auth.userId,
      approver_ids: [auth.userId],
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
      payload: {
        action_rid: action.rid,
        target_id: body.target_id ?? null,
        params,
      },
      workflow_id: workflowId,
    }).select().single();
    if (hitlConfirmErr || !hitlConfirm) {
      return jsonResponse({ error: 'confirmation_failed', message: hitlConfirmErr?.message ?? 'unknown' }, 500);
    }

    // workflow_signals 会被 trigger tg_hitl_to_workflow_signal 自动写入 (Loop 2/3)

    return jsonResponse({
      ok: true,
      mode: 'confirmed',
      action_rid: action.rid,
      workflow_id: workflowId,
      hitl_request_id: hitlConfirm.id,
      workflow_started: true,
      note: 'PoC: mock Temporal start. 生产接入 Temporal worker 后真实调度.',
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});