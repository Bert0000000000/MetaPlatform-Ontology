// supabase/functions/publish-preset/index.ts
// Loop 3/5: POST /functions/v1/publish-preset (developer publishes preset)
// Per Issue #3: name unique per tenant, valid semver, manifest schema

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface PublishRequest {
  slug: string;
  name: string;
  description?: string;
  category: string;
  version: string;
  manifest: Record<string, unknown>;
  visibility?: 'public' | 'private';
  changelog?: string;
}

const SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const VALID_CATEGORIES = ['support', 'knowledge', 'ontology', 'code-review', 'data', 'contract', 'hitl', 'dashboard', 'custom'];

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
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can publish presets', 403);
    }

    const body = await req.json() as PublishRequest;

    const errors: string[] = [];
    if (!body.slug || !/^[a-z0-9-]{3,64}$/.test(body.slug)) {
      errors.push('slug must be 3-64 chars, lowercase alphanumeric and hyphens');
    }
    if (!body.name || body.name.length < 3) {
      errors.push('name required, min 3 chars');
    }
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      errors.push('category must be one of: ' + VALID_CATEGORIES.join(', '));
    }
    if (!body.version || !SEMVER.test(body.version)) {
      errors.push('version must be semver (e.g. 1.0.0 or 1.2.3-rc.1)');
    }
    if (!body.manifest || typeof body.manifest !== 'object') {
      errors.push('manifest required (object)');
    }
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing } = await supabase
      .schema('mp_preset_registry')
      .from('presets')
      .select('id, slug')
      .eq('tenant_id', auth.tenantId)
      .eq('slug', body.slug)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        error: 'preset slug already exists for this tenant',
        existing_id: existing.id,
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: preset, error: presetErr } = await supabase
      .schema('mp_preset_registry')
      .from('presets')
      .insert({
        slug: body.slug,
        name: body.name,
        description: body.description ?? '',
        category: body.category,
        tenant_id: auth.tenantId,
        current_version: body.version,
        downloads_count: 0,
        visibility: body.visibility ?? 'public',
        maintainer_id: auth.userId,
      })
      .select()
      .single();

    if (presetErr || !preset) {
      return new Response(JSON.stringify({ error: presetErr?.message ?? 'Failed to create preset' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: version, error: verErr } = await supabase
      .schema('mp_preset_registry')
      .from('versions')
      .insert({
        preset_id: preset.id,
        tenant_id: auth.tenantId,
        version: body.version,
        manifest: body.manifest,
        manifest_size: JSON.stringify(body.manifest).length,
        changelog: body.changelog ?? 'Initial ' + body.version + ' release',
        is_current: true,
        published_by: auth.userId,
      })
      .select()
      .single();

    if (verErr || !version) {
      await supabase.schema('mp_preset_registry').from('presets').delete().eq('id', preset.id);
      return new Response(JSON.stringify({ error: verErr?.message ?? 'Failed to create version' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      preset_id: preset.id,
      slug: preset.slug,
      version_id: version.id,
      version: version.version,
      visibility: preset.visibility,
      created_at: preset.created_at,
      message: 'Published ' + preset.slug + '@' + version.version,
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
