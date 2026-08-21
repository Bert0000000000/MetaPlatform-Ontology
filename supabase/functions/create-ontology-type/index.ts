// supabase/functions/create-ontology-type/index.ts
//
// POST /functions/v1/create-ontology-type
//   body: { type, ...payload }
//   type=object   → 创建 ObjectType
//   type=relation → 创建 RelationType
//   type=action   → 创建 ActionType
// Auth: admin/owner only (本体是核心配置面)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

type Kind = 'object' | 'relation' | 'action';

const VALID_HITL_TYPES = ['workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm'];
const VALID_PERMISSIONS = ['admin', 'owner', 'member', 'guest'];
const VALID_CARDINALITIES = ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'];
const VALID_STATUSES = ['draft', 'active', 'deprecated'];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validate(kind: Kind, body: Record<string, unknown>): string | null {
  if (kind === 'object') {
    if (!body.rid || typeof body.rid !== 'string') return 'rid (string) required';
    if (!body.slug || typeof body.slug !== 'string') return 'slug (string) required';
    if (!body.name || typeof body.name !== 'string') return 'name (string) required';
    if (body.status && !VALID_STATUSES.includes(body.status as string)) return `status must be one of: ${VALID_STATUSES.join(', ')}`;
    return null;
  }
  if (kind === 'relation') {
    if (!body.rid || typeof body.rid !== 'string') return 'rid (string) required';
    if (!body.name || typeof body.name !== 'string') return 'name (string) required';
    if (!body.from_type || typeof body.from_type !== 'string') return 'from_type (string) required';
    if (!body.to_type || typeof body.to_type !== 'string') return 'to_type (string) required';
    if (body.cardinality && !VALID_CARDINALITIES.includes(body.cardinality as string)) return `cardinality must be one of: ${VALID_CARDINALITIES.join(', ')}`;
    if (body.status && !VALID_STATUSES.includes(body.status as string)) return `status must be one of: ${VALID_STATUSES.join(', ')}`;
    return null;
  }
  // action
  if (!body.rid || typeof body.rid !== 'string') return 'rid (string) required';
  if (!body.name || typeof body.name !== 'string') return 'name (string) required';
  if (!body.target_type || typeof body.target_type !== 'string') return 'target_type (ObjectType rid) required';
  if (body.permission && !VALID_PERMISSIONS.includes(body.permission as string)) return `permission must be one of: ${VALID_PERMISSIONS.join(', ')}`;
  if (body.hitl_type && !VALID_HITL_TYPES.includes(body.hitl_type as string)) return `hitl_type must be one of: ${VALID_HITL_TYPES.join(', ')}`;
  return null;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'POST only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'create requires admin or owner role' }, 403);
    }

    let body: { type: Kind } & Record<string, unknown>;
    try {
      body = await req.json() as typeof body;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    const kind = (body.type ?? '').toString().toLowerCase() as Kind;
    if (!['object', 'relation', 'action'].includes(kind)) {
      return jsonResponse({ error: 'invalid_type', message: 'type must be object | relation | action' }, 400);
    }

    const validationErr = validate(kind, body);
    if (validationErr) {
      return jsonResponse({ error: 'validation', message: validationErr }, 400);
    }

    // 构造行
    let row: Record<string, unknown>;
    if (kind === 'object') {
      row = {
        rid: body.rid, slug: body.slug, name: body.name,
        description: body.description ?? null,
        properties: body.properties ?? {},
        payload_schema: body.payload_schema ?? {},
        link_types: body.link_types ?? [],
        action_types: body.action_types ?? [],
        status: body.status ?? 'draft',
        version: body.version ?? 'v1',
      };
    } else if (kind === 'relation') {
      row = {
        rid: body.rid, name: body.name,
        description: body.description ?? null,
        from_type: body.from_type, to_type: body.to_type,
        cardinality: body.cardinality ?? 'one_to_many',
        properties: body.properties ?? {},
        status: body.status ?? 'draft',
      };
    } else {
      row = {
        rid: body.rid, name: body.name,
        description: body.description ?? null,
        target_type: body.target_type,
        parameters: body.parameters ?? {},
        permission: body.permission ?? 'member',
        workflow_name: body.workflow_name ?? null,
        hitl_type: body.hitl_type ?? null,
        status: body.status ?? 'draft',
      };
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const tableName = kind === 'object' ? 'ontology_object_types' : kind === 'relation' ? 'ontology_relation_types' : 'ontology_action_types';
    // service_role bypass RLS but tg_inject_tenant still reads auth.jwt() (NULL for service_role).
    // 显式带 tenant_id 避免 trigger 异常.
    const { data, error } = await sb.from(tableName).insert({ ...row, tenant_id: auth.tenantId }).select().single();
    if (error || !data) {
      return jsonResponse({ error: 'insert_failed', message: error?.message ?? 'unknown' }, 500);
    }

    return jsonResponse({ ok: true, type: kind, ...data }, 201);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});