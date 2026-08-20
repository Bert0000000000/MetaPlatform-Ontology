// supabase/functions/get-ontology-type/index.ts
//
// GET /functions/v1/get-ontology-type?type=object|relation|action&id=<uuid>
//   查单条; type 同 list-ontology-types
//
// 兼容 rid 传参: ?type=object&rid=customer (返回最新 version=active 的)
// 否则 ?id=<uuid>

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

type Kind = 'object' | 'relation' | 'action';

const TABLE_MAP: Record<Kind, { schema: string; table: string; cols: string }> = {
  object:   { schema: 'public', table: 'ontology_object_types',
              cols: 'id, rid, slug, name, description, version, properties, payload_schema, link_types, action_types, status, created_at, updated_at' },
  relation: { schema: 'public', table: 'ontology_relation_types',
              cols: 'id, rid, name, description, from_type, to_type, cardinality, properties, status, created_at, updated_at' },
  action:   { schema: 'public', table: 'ontology_action_types',
              cols: 'id, rid, name, description, target_type, parameters, permission, workflow_name, hitl_type, status, created_at, updated_at' },
};

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

    const url = new URL(req.url);
    const kindRaw = (url.searchParams.get('type') ?? 'object').toLowerCase();
    if (!['object', 'relation', 'action'].includes(kindRaw)) {
      return jsonResponse({ error: 'invalid_type', message: 'type must be object | relation | action' }, 400);
    }
    const kind = kindRaw as Kind;
    const cfg = TABLE_MAP[kind];

    const id = url.searchParams.get('id');
    const rid = url.searchParams.get('rid');

    let query = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } } },
    )
      .schema(cfg.schema)
      .from(cfg.table)
      .select(cfg.cols);

    if (id) {
      query = query.eq('id', id).limit(1);
    } else if (rid) {
      query = query.eq('rid', rid).eq('status', 'active').order('created_at', { ascending: false }).limit(1);
    } else {
      return jsonResponse({ error: 'missing_param', message: 'id or rid is required' }, 400);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse({ error: 'query_failed', message: error.message }, 500);
    }
    const row = data && data.length > 0 ? data[0] : null;
    if (!row) {
      return jsonResponse({ error: 'not_found', message: `${kind} type not found` }, 404);
    }

    return jsonResponse({ ok: true, type: kind, ...row }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});