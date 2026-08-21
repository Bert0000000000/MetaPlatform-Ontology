// supabase/functions/list-workflow-signals/index.ts
//
// GET /functions/v1/list-workflow-signals?status=pending&limit=50
//   给 Temporal worker 用, 拉取 pending signals 然后调 workflow.signal()
//
// 后续 worker 应使用 Realtime WS 订阅 (低延迟), 这里提供 HTTP 兜底.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

const VALID_STATUSES = ['pending', 'sent', 'acknowledged', 'failed'];

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
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'only admin/owner can list workflow signals' }, 403);
    }

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status') ?? 'pending';
    if (!VALID_STATUSES.includes(statusFilter)) {
      return jsonResponse({ error: 'invalid_status', message: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50') || 50));

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await sb
      .from('workflow_signals')
      .select('id, hitl_request_id, workflow_id, signal_name, payload, status, created_at')
      .eq('status', statusFilter)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      return jsonResponse({ error: 'query_failed', message: error.message }, 500);
    }

    return jsonResponse({
      ok: true,
      status_filter: statusFilter,
      count: data?.length ?? 0,
      results: data ?? [],
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});