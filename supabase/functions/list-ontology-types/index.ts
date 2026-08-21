// supabase/functions/list-ontology-types/index.ts
// PRD: docs/active/prd/mp-ontology.md
// ADR:  docs/active/decisions/ADR-0056-ontology-generation.md
// Batch: MetaPlatform-ONTOLOGY-GEN-01 (Loop 2/3)
//
// GET /functions/v1/list-ontology-types?type=object|relation|action&status=active
//   统一查询 3 个本体表 (ObjectType / RelationType / ActionType)
//   ?type=object (默认) → ontology_object_types
//   ?type=relation    → ontology_relation_types
//   ?type=action      → ontology_action_types

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
      return jsonResponse({
        error: 'invalid_type',
        message: 'type must be one of: object | relation | action',
      }, 400);
    }
    const kind = kindRaw as Kind;
    const statusFilter = url.searchParams.get('status');
    const ridFilter = url.searchParams.get('rid');
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100') || 100));

    const cfg = TABLE_MAP[kind];
    let query = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('authorization') ?? '' } } },
    )
      .schema(cfg.schema)
      .from(cfg.table)
      .select(cfg.cols)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (statusFilter) query = query.eq('status', statusFilter);
    if (ridFilter) query = query.eq('rid', ridFilter);

    const { data, error } = await query;
    if (error) {
      return jsonResponse({ error: 'query_failed', message: error.message }, 500);
    }

    return jsonResponse({
      ok: true,
      type: kind,
      count: data?.length ?? 0,
      results: data ?? [],
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});