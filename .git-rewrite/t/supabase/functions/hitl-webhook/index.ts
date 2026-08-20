// supabase/functions/hitl-webhook/index.ts
// PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §6.4
// HITL Hub webhook receiver: 第三方 SaaS (钉钉/飞书/企微) 审批回调 → 更新 hitl_requests + Temporal signal

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { Client as TemporalClient } from "https://esm.sh/@temporalio/client@1.11.0";
import { createHmac } from "https://deno.land/std@0.224.0/crypto/mod.ts";

interface WebhookPayload {
  hitl_request_id: string;
  decision: 'approved' | 'rejected';
  decided_by: string;
  comment?: string;
  // SaaS-specific
  source: 'dingtalk' | 'feishu' | 'wecom';
  signature: string;
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const source = new URL(req.url).searchParams.get('source');
  const signature = req.headers.get('x-saas-signature');
  const secret = Deno.env.get(`HITL_WEBHOOK_SECRET_${source?.toUpperCase()}`);

  if (!secret || !signature) return false;

  const hmac = await createHmac('sha256', secret).update(body).digest();
  const expected = btoa(String.fromCharCode(...hmac));

  return signature === expected;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.text();

    // 1. 验签
    if (!await verifySignature(req, body)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
    }

    const payload = JSON.parse(body) as WebhookPayload;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 2. 查 hitl_request
    const { data: req, error: reqErr } = await supabase
      .from("hitl_requests")
      .select("*")
      .eq("id", payload.hitl_request_id)
      .single();

    if (reqErr || !req) {
      return new Response(JSON.stringify({ error: "hitl_request not found" }), { status: 404 });
    }

    if (req.status !== 'pending') {
      return new Response(JSON.stringify({ error: "hitl_request already decided" }), { status: 409 });
    }

    // 3. 更新 status
    await supabase.from("hitl_requests").update({
      status: payload.decision === 'approved' ? 'approved' : 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: payload.decided_by,
      decision_payload: { comment: payload.comment ?? null },
    }).eq("id", payload.hitl_request_id);

    // 4. Temporal signal — 唤醒 workflow
    if (req.workflow_id) {
      const temporal = new TemporalClient({
        address: Deno.env.get("TEMPORAL_ADDRESS") ?? "temporal.mp-orchestration.svc:7233",
      });

      const handle = temporal.workflow.getHandle(req.workflow_id);
      await handle.signal("approvalDecision", {
        decision: payload.decision,
        comment: payload.comment,
        decided_by: payload.decided_by,
      });
    }

    return new Response(JSON.stringify({ status: "processed" }), {
      status: 200,
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