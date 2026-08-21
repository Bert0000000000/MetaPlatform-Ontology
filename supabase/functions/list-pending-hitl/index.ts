// supabase/functions/list-pending-hitl/index.ts
// PRD: docs/active/prd/hitl-hub.md
// ADR:  docs/active/decisions/ADR-0053-hitl-hub.md
//
// GET /functions/v1/list-pending-hitl — 当前用户的待审批列表
//   ?type=workflow_saas&limit=20 (可选过滤)
// Auth: 仅返回 approver_ids 含当前用户的 + tenant 内的 pending

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

const VALID_TYPES = ['workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm'];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed', message: 'GET only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);

    const url = new URL(req.url);
    const typeFilter = url.searchParams.get('type');
    if (typeFilter && !VALID_TYPES.includes(typeFilter)) {
      return jsonResponse({
        error: 'invalid_type',
        message: `type must be one of: ${VALID_TYPES.join(', ')}`,
      }, 400);
    }
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20') || 20));

    // RLS 自动按 tenant_id 过滤, 我们额外按 approver_ids 包含 user 过滤
    // PostgREST 支持 cs (contains) operator on uuid[] column
    let query = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } } },
    )
      .from('hitl_requests')
      .select('id, type, status, title, description, requester_id, approver_ids, payload, workflow_id, deadline_at, escalation_level, created_at, updated_at')
      .eq('status', 'pending')
      .contains('approver_ids', [auth.userId])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (typeFilter) {
      query = query.eq('type', typeFilter);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse({ error: 'query_failed', message: error.message }, 500);
    }

    return jsonResponse({
      ok: true,
      count: data?.length ?? 0,
      type_filter: typeFilter,
      results: data ?? [],
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});