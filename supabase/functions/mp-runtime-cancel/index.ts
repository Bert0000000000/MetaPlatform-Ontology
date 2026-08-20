// supabase/functions/mp-runtime-cancel/index.ts
// PRD: docs/active/prd/mp-runtime.md §3
// Batch: MP-V6-MP-RUNTIME-01
// POST /functions/v1/mp-runtime-cancel
// 取消一个 mp-runtime session (manual RLS: tenant_id == auth.tenantId)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface CancelRequest {
  session_id?: string;
  reason?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const auth = await verifyAuth(req);

    const body = await req.json() as CancelRequest;
    const errors: string[] = [];
    if (!body.session_id || !UUID_RE.test(body.session_id)) {
      errors.push('session_id required, must be a UUID');
    }
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) {
      errors.push('reason must be a string, max 500 chars');
    }
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'mp_runtime' } },
    );

    // 1. 查 session (manual RLS)
    const { data: existing, error: lookupErr } = await supabase
      .from('sessions')
      .select('id, status, tenant_id')
      .eq('id', body.session_id!)
      .maybeSingle();

    if (lookupErr) {
      return new Response(JSON.stringify({ error: 'lookup failed: ' + lookupErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!existing || existing.tenant_id !== auth.tenantId) {
      return new Response(JSON.stringify({
        error: 'session not found or not accessible (tenant isolation)',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (existing.status !== 'queued' && existing.status !== 'running') {
      return new Response(JSON.stringify({
        error: 'session not cancellable',
        current_status: existing.status,
        session_id: existing.id,
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. UPDATE: status='cancelled' + finished_at + reason 存进 error_message
    const { data: updated, error: updateErr } = await supabase
      .from('sessions')
      .update({
        status: 'cancelled',
        finished_at: new Date().toISOString(),
        error_message: body.reason ? ('cancelled: ' + body.reason) : 'cancelled by user',
      })
      .eq('id', body.session_id!)
      .select()
      .single();

    if (updateErr || !updated) {
      return new Response(JSON.stringify({
        error: 'cancel failed: ' + (updateErr?.message ?? 'unknown'),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      session_id: updated.id,
      status: updated.status,
      cancelled_at: updated.finished_at,
      previous_status: existing.status,
      tenant_id: auth.tenantId,
      message: 'Session cancelled',
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