// supabase/functions/apply-ontology-change/index.ts
// PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.15 (12 Ontology Kernel)
// Edge Function: ActionType.apply(mode='preview' | 'confirmed') → 触发 Temporal workflow

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { Client as TemporalClient } from "https://esm.sh/@temporalio/client@1.11.0";

interface ApplyRequest {
  change_id: string;             // pending_object_changes.id
  mode: 'preview' | 'confirmed';
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
    if (!body.change_id || !body.mode) throw new Error("Missing change_id or mode");

    // 1. 读 pending_object_changes
    const { data: change, error: chErr } = await supabase
      .from("pending_object_changes")
      .select("*")
      .eq("id", body.change_id)
      .eq("tenant_id", tenantId)
      .single();

    if (chErr || !change) throw new Error(`Change not found: ${body.change_id}`);

    // 2. 启动 Temporal workflow (根据 mode 选不同 task queue)
    const temporal = new TemporalClient({
      address: Deno.env.get("TEMPORAL_ADDRESS") ?? "temporal.mp-orchestration.svc:7233",
    });

    const workflowId = `apply-ontology-${body.change_id}`;
    const handle = await temporal.workflow.start(
      body.mode === "preview" ? "previewOntologyChangeWorkflow" : "applyOntologyChangeWorkflow",
      {
        args: [{ change_id: body.change_id, tenant_id: tenantId, actor_id: user.id }],
        taskQueue: "ontology-apply",
        workflowId,
      },
    );

    // 3. 写 hitl_requests (mode='preview' 时)
    if (body.mode === "preview") {
      await supabase.from("hitl_requests").insert({
        tenant_id: tenantId,
        workflow_id: handle.workflowId,
        type: "action_confirm",
        status: "pending",
        title: `预览本体变更: ${change.title ?? body.change_id}`,
        description: change.description ?? null,
        context: { change_id: body.change_id, change_diff: change.diff ?? null },
        approver_user_ids: change.approver_user_ids ?? [user.id],
        timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return new Response(JSON.stringify({
      workflow_id: handle.workflowId,
      run_id: handle.firstExecutionRunId,
      status: "started",
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