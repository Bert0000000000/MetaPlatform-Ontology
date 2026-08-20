// supabase/functions/list-active-installs/index.ts
// Loop 5/5: POST /functions/v1/list-active-installs (per workspace)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface ListRequest {
  workspace_id: string;
  preset_slug?: string;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can list installs', 403);
    }
    const body = await req.json() as ListRequest;
    if (!body.workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), { status: 400 });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'mp_preset_registry' } });

    let q = supabase.from('installs')
      .select('id, preset_id, version_id, workspace_id, status, installed_at, config_override, presets (slug, name, current_version)')
      .eq('tenant_id', auth.tenantId)
      .eq('workspace_id', body.workspace_id)
      .eq('status', 'active');

    if (body.preset_slug) q = q.eq('presets.slug', body.preset_slug);

    const { data, error } = await q;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify({
      data: data ?? [],
      count: data?.length ?? 0,
      workspace_id: body.workspace_id,
    }), { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
