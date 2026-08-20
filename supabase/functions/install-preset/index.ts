// supabase/functions/install-preset/index.ts
// Loop 4/5: POST /functions/v1/install-preset
// Per Issue #4: install a preset to a workspace (soft-deletes prior active install)

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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can install presets', 403);
    }

    const body = await req.json() as InstallRequest;
    const errors: string[] = [];
    if (!body.preset_slug && !body.preset_id) errors.push('preset_slug or preset_id required');
    if (!body.workspace_id || body.workspace_id.length < 1 || body.workspace_id.length > 100) {
      errors.push('workspace_id required, 1-100 chars');
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

    // Resolve preset_id from slug (within tenant)
    let presetId = body.preset_id;
    if (!presetId && body.preset_slug) {
      const { data: preset, error: psErr } = await supabase
        .schema('mp_preset_registry')
        .from('presets')
        .select('id, current_version, name')
        .eq('tenant_id', auth.tenantId)
        .eq('slug', body.preset_slug)
        .maybeSingle();
      if (psErr || !preset) {
        return new Response(JSON.stringify({ error: 'preset not found: ' + body.preset_slug }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      presetId = preset.id;
      body.version = body.version ?? preset.current_version;
    }

    // Resolve version_id (specific version or current)
    let versionId: string;
    if (body.version) {
      const { data: ver, error: vErr } = await supabase
        .schema('mp_preset_registry')
        .from('versions')
        .select('id')
        .eq('preset_id', presetId!)
        .eq('version', body.version)
        .maybeSingle();
      if (vErr || !ver) {
        return new Response(JSON.stringify({ error: 'version not found: ' + body.version }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      versionId = ver.id;
    } else {
      const { data: ver, error: vErr } = await supabase
        .schema('mp_preset_registry')
        .from('versions')
        .select('id')
        .eq('preset_id', presetId!)
        .eq('is_current', true)
        .maybeSingle();
      if (vErr || !ver) {
        return new Response(JSON.stringify({ error: 'no current version for preset' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      versionId = ver.id;
    }

    // Call install_preset RPC
    const { data: install, error: rpcErr } = await supabase.rpc('install_preset', {
      p_tenant_id: auth.tenantId,
      p_preset_id: presetId,
      p_version_id: versionId,
      p_workspace_id: body.workspace_id!,
      p_config_override: body.config_override ?? {},
    });

    if (rpcErr) {
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      install_id: (install as { id?: string })?.id ?? null,
      preset_id: presetId,
      version_id: versionId,
      workspace_id: body.workspace_id,
      status: 'active',
      installed_at: new Date().toISOString(),
      message: 'Installed preset ' + body.preset_slug + '@' + body.version + ' to ' + body.workspace_id,
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
