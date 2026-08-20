// supabase/functions/uninstall-preset/index.ts
// Loop 5/5: POST /functions/v1/uninstall-preset (soft-delete install)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface UninstallRequest {
  install_id?: string;
  workspace_id?: string;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can uninstall', 403);
    }
    const body = await req.json() as UninstallRequest;
    if (!body.install_id) {
      return new Response(JSON.stringify({ error: 'install_id required' }), { status: 400 });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'mp_preset_registry' } });

    const { data: existing, error: eErr } = await supabase
      .from('installs')
      .select('id, status, workspace_id, tenant_id, preset_id')
      .eq('id', body.install_id)
      .maybeSingle();

    if (eErr) {
      return new Response(JSON.stringify({ error: eErr.message }), { status: 500 });
    }
    if (!existing) {
      return new Response(JSON.stringify({ error: 'install not found' }), { status: 404 });
    }
    if (existing.tenant_id !== auth.tenantId) {
      return new Response(JSON.stringify({ error: 'install belongs to other tenant' }), { status: 403 });
    }
    if (existing.status === 'uninstalled') {
      return new Response(JSON.stringify({ error: 'install already uninstalled' }), { status: 404 });
    }

    const { data: updated, error: uErr } = await supabase
      .from('installs')
      .update({ status: 'uninstalled', uninstalled_at: new Date().toISOString() })
      .eq('id', body.install_id)
      .select()
      .single();

    if (uErr || !updated) {
      return new Response(JSON.stringify({ error: uErr?.message ?? 'update failed' }), { status: 500 });
    }

    return new Response(JSON.stringify({
      install_id: body.install_id,
      status: 'uninstalled',
      uninstalled_at: (updated as { uninstalled_at: string }).uninstalled_at,
      message: 'Uninstalled ' + (existing as { workspace_id: string }).workspace_id,
    }), { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
