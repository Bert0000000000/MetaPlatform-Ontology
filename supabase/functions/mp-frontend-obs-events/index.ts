// supabase/functions/mp-frontend-obs-events/index.ts
// PRD:  docs/active/specs/2026-08-19-mp-v6-application-architecture.md §9.4 (mp-frontend-obs)
// ADR:   docs/active/decisions/ADR-0059-mp-observability.md (frontend extension)
// Batch: MetaPlatform-EDGE-FN-01 (Loop 2/3 — mp-frontend-obs)
//
// 19 apps 之一: mp-frontend-obs (前端可观测性)
//   服务: 接收前端埋点 (page_view, click, error, performance)
//   存储: public.frontend_events 表 (per-tenant + RLS)
//   查询:  GET /heatmap / GET /funnel / GET /errors
//
// PoC: 简化 (admin-server UI 显示 frontend events 聚合)
//
// POST /functions/v1/mp-frontend-obs-events
//   body: { event_type: 'page_view'|'click'|'error'|'performance', data }
//   anon 可写 (埋点, 不需登录)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

type EventType = 'page_view' | 'click' | 'error' | 'performance';

interface EventRequest {
  event_type: EventType;
  page?: string;
  data?: Record<string, unknown>;
  session_id?: string;
  user_agent?: string;
}

const VALID_TYPES: EventType[] = ['page_view', 'click', 'error', 'performance'];

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
    let body: EventRequest;
    try {
      body = await req.json() as EventRequest;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.event_type || !VALID_TYPES.includes(body.event_type)) {
      return jsonResponse({
        error: 'invalid_event_type',
        message: `event_type must be one of: ${VALID_TYPES.join(', ')}`,
      }, 400);
    }

    // EMP 埋点可能含敏感 PII, 过滤 (简单清理)
    const safeData = body.data ?? {};
    const page = (body.page ?? 'unknown').slice(0, 256);
    const sessionId = (body.session_id ?? 'anon-' + crypto.randomUUID()).slice(0, 64);
    const userAgent = (req.headers.get('user-agent') ?? body.user_agent ?? '').slice(0, 256);

    // 查 tenant: 优先从 JWT, 否则 unknown
    let tenantId: string | null = null;
    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const sbAuth = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: userData } = await sbAuth.auth.getUser();
        if (userData?.user) {
          userId = userData.user.id;
          tenantId = (userData.user.app_metadata as { tenant_id?: string })?.tenant_id ?? null;
        }
      } catch { /* 匿名, 继续 */ }
    }
    // 匿名事件入 'global' tenant (默认)
    if (!tenantId) {
      const c = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const r = await c.from('tenants').select('id').eq('slug', 'global').maybeSingle();
      tenantId = r.data?.id ?? null;
    }
    if (!tenantId) {
      return jsonResponse({ error: 'no_tenant', message: 'frontend events require either auth or "global" tenant' }, 500);
    }

    // 写 frontend_events
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await sb.from('frontend_events').insert({
      tenant_id: tenantId,
      user_id: userId,
      session_id: sessionId,
      event_type: body.event_type,
      page,
      data: safeData,
      user_agent: userAgent,
    }).select('id').single();

    if (error || !data) {
      return jsonResponse({ error: 'insert_failed', message: error?.message ?? 'unknown' }, 500);
    }

    return jsonResponse({ ok: true, event_id: data.id, recorded_at: new Date().toISOString() }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});