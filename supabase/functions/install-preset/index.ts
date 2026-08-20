// supabase/functions/install-preset/index.ts
// Loop 4/5: POST /functions/v1/install-preset (per Issue #4)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface InstallRequest {
  preset_slug?: string;
  preset_id?: string;
  workspace_id?: string;
  version?: string;
  config_override?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can install presets', 403);
    }
    const body = await req.json() as InstallRequest;
    const errors: string[] = [];
    if (!body.preset_slug && !body.preset_id) errors.push('preset_slug or preset_id required');
    if (!body.workspace_id || body.workspace_id.length < 1 || body.workspace_id.length > 100) errors.push('workspace_id required, 1-100 chars');
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'mp_preset_registry' } },
    );

    let presetId = body.preset_id;
    if (!presetId && body.preset_slug) {
      const { data: preset, error: psErr } = await supabase
        .from('presets')
        .select('id, current_version, name')
        .eq('slug', body.preset_slug)
        .or('tenant_id.is.null,tenant_id.eq.' + auth.tenantId)
        .maybeSingle();
      if (psErr || !preset) {
        return new Response(JSON.stringify({ error: 'preset not found: ' + body.preset_slug }), { status: 404 });
      }
      presetId = preset.id;
      body.version = body.version ?? preset.current_version;
    }

    let versionId: string;
    if (body.version) {
      const { data: ver, error: vErr } = await supabase
        .from('versions')
        .select('id')
        .eq('preset_id', presetId!)
        .eq('version', body.version)
        .maybeSingle();
      if (vErr || !ver) {
        return new Response(JSON.stringify({ error: 'version not found: ' + body.version }), { status: 404 });
      }
      versionId = ver.id;
    } else {
      const { data: ver } = await supabase
        .from('versions')
        .select('id')
        .eq('preset_id', presetId!)
        .eq('is_current', true)
        .maybeSingle();
      if (!ver) {
        return new Response(JSON.stringify({ error: 'no current version for preset' }), { status: 404 });
      }
      versionId = ver.id;
    }

    // Soft-delete prior active install + insert new
    await supabase.from('installs')
      .update({ status: 'uninstalled', uninstalled_at: new Date().toISOString() })
      .eq('tenant_id', auth.tenantId)
      .eq('preset_id', presetId!)
      .eq('workspace_id', body.workspace_id!)
      .eq('status', 'active');

    const { data: ins, error: insErr } = await supabase.from('installs').insert({
      tenant_id: auth.tenantId,
      preset_id: presetId,
      version_id: versionId,
      workspace_id: body.workspace_id!,
      config_override: body.config_override ?? {},
      status: 'active',
      installed_by: auth.userId,
    }).select().single();

    if (insErr || !ins) {
      return new Response(JSON.stringify({ error: insErr?.message ?? 'insert failed' }), { status: 500 });
    }

    // Bump downloads
    supabase.rpc('bump_preset_downloads', { p_preset_id: presetId })
      .then(() => {})
      .catch(() => {});

    return new Response(JSON.stringify({
      install_id: (ins as { id: string }).id,
      preset_id: presetId,
      version_id: versionId,
      workspace_id: body.workspace_id,
      status: 'active',
      installed_at: new Date().toISOString(),
      message: 'Installed ' + body.preset_slug + ' to ' + body.workspace_id,
    }), { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
