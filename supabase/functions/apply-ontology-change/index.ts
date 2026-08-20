// supabase/functions/apply-ontology-change/index.ts
// PRD: docs/active/prd/ontology-gen.md §4.2
// Batch: MP-V6-ONTOLOGY-GEN-01 (full implementation)
// Edge Function: ontology 变更入口, mode=preview|confirmed → Temporal workflow

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { Client as TemporalClient } from "https://esm.sh/@temporalio/client@1.11.0";

interface ApplyRequest {
  change_id: string;
  mode: 'preview' | 'confirmed';
  payload?: Record<string, unknown>;       // mode='preview' 时可由 dsh 自动生成
  title?: string;
  description?: string;
  object_type_rid?: string;
  change_type?: 'create' | 'update' | 'delete' | 'rename';
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing Authorization");

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!user) throw new Error("Invalid JWT");
    const tenantId = (user.app_metadata as { tenant_id?: string }).tenant_id;
    if (!tenantId) throw new Error("JWT missing tenant_id");

    const body = await req.json() as ApplyRequest;
    if (!body.mode) throw new Error("Missing mode");

    const temporal = new TemporalClient({
      address: Deno.env.get("TEMPORAL_ADDRESS") ?? "temporal.mp-orchestration.svc:7233",
    });

    let changeId = body.change_id;

    // mode='preview' 且 dsh 直接传 payload: 先 INSERT pending_object_changes
    if (body.mode === 'preview' && !changeId) {
      if (!body.object_type_rid || !body.change_type || !body.payload) {
        throw new Error("preview mode requires object_type_rid, change_type, payload");
      }

      const { data: created, error: createErr } = await supabase
        .from("pending_object_changes")
        .insert({
          tenant_id: tenantId,
          object_type_rid: body.object_type_rid,
          change_type: body.change_type,
          payload: body.payload,
          title: body.title ?? null,
          description: body.description ?? null,
          status: 'pending',
          approver_user_ids: [user.id],
        })
        .select()
        .single();

      if (createErr || !created) throw new Error(`pending_object_changes insert failed: ${createErr?.message}`);
      changeId = created.id;
    }

    if (!changeId) throw new Error("change_id required");

    // 启动 Temporal workflow
    const workflowId = `ontology-${body.mode}-${changeId}`;
    const handle = await temporal.workflow.start(
      body.mode === 'preview' ? 'previewOntologyChangeWorkflow' : 'applyOntologyChangeWorkflow',
      {
        args: [{ change_id: changeId, tenant_id: tenantId, actor_id: user.id }],
        taskQueue: 'ontology-apply',
        workflowId,
      },
    );

    return new Response(JSON.stringify({
      change_id: changeId,
      workflow_id: handle.workflowId,
      run_id: handle.firstExecutionRunId,
      mode: body.mode,
      status: 'started',
    }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});