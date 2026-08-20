// supabase/functions/mp-runtime-trigger/index.ts
// PRD: docs/active/prd/mp-runtime.md §3
// Batch: MP-V6-MP-RUNTIME-01
// POST /functions/v1/mp-runtime-trigger
// 触发一个 mp-runtime session: 校验 function 注册表, 创建 session row (status='queued')

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface TriggerRequest {
  function_name?: string;
  input_payload?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}

const FUNCTION_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const VALID_PRIORITIES = ['low', 'normal', 'high'];

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const auth = await verifyAuth(req);

    const body = await req.json() as TriggerRequest;
    const errors: string[] = [];
    if (!body.function_name || !FUNCTION_NAME_RE.test(body.function_name)) {
      errors.push('function_name required, must match /^[a-z0-9][a-z0-9._-]{1,63}$/');
    }
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      errors.push('priority must be one of: ' + VALID_PRIORITIES.join(', '));
    }
    if (body.input_payload !== undefined && (typeof body.input_payload !== 'object' || body.input_payload === null || Array.isArray(body.input_payload))) {
      errors.push('input_payload must be a JSON object');
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
    );

    // 1. 校验 function 注册表 (global OR tenant-scoped)
    const { data: func, error: fnErr } = await supabase
      .schema('mp_runtime')
      .from('functions')
      .select('id, name, version, handler, config')
      .eq('name', body.function_name!)
      .or('tenant_id.is.null,tenant_id.eq.' + auth.tenantId)
      .maybeSingle();

    if (fnErr || !func) {
      return new Response(JSON.stringify({
        error: 'function not registered: ' + body.function_name,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. 创建 session row (status='queued', tenant_id 自动注入 via tg_inject_tenant)
    const { data: session, error: sessErr } = await supabase
      .schema('mp_runtime')
      .from('sessions')
      .insert({
        tenant_id: auth.tenantId,
        user_id: auth.userId,
        function_name: body.function_name!,
        input_payload: body.input_payload ?? {},
        status: 'queued',
      })
      .select()
      .single();

    if (sessErr || !session) {
      return new Response(JSON.stringify({
        error: 'failed to create session: ' + (sessErr?.message ?? 'unknown'),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      session_id: session.id,
      status: session.status,
      function_name: session.function_name,
      function_version: func.version,
      tenant_id: auth.tenantId,
      started_at: session.started_at,
      message: 'Runtime session queued for ' + body.function_name,
    }), {
      status: 201,
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