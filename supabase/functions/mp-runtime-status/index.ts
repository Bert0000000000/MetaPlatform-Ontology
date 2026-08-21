// supabase/functions/mp-runtime-status/index.ts
// PRD: docs/active/prd/mp-runtime.md §3
<<<<<<< Updated upstream
// Batch: MetaPlatform-MP-RUNTIME-01
=======
// Batch: MP-V6-MP-RUNTIME-01
>>>>>>> Stashed changes
// GET /functions/v1/mp-runtime-status?session_id=<uuid>
// 读取一个 mp-runtime session 的当前状态 (manual RLS: tenant_id == auth.tenantId)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const auth = await verifyAuth(req);

    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return new Response(JSON.stringify({
        error: 'Validation failed',
        details: ['session_id query param required, must be a UUID'],
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // service_role: bypass RLS, then manually enforce tenant isolation
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'mp_runtime' } },
    );

    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .select('id, status, function_name, result, error_message, duration_ms, started_at, finished_at, tenant_id')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessErr) {
      return new Response(JSON.stringify({ error: 'query failed: ' + sessErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!session || session.tenant_id !== auth.tenantId) {
      return new Response(JSON.stringify({
        error: 'session not found or not accessible (tenant isolation)',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      session_id: session.id,
      status: session.status,
      function_name: session.function_name,
      duration_ms: session.duration_ms,
      started_at: session.started_at,
      finished_at: session.finished_at,
      result: session.result,
      error_message: session.error_message,
      tenant_id: session.tenant_id,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});