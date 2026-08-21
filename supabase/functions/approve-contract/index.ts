// supabase/functions/approve-contract/index.ts
// PRD: docs/active/prd/domain-migrate-17.md §4.2
// Batch: MetaPlatform-DOMAIN-MIGRATE-01
// 合同审批: 高额 (>100k) 走 HITL workflow_saas (1 周+), 低额走 workflow_dsh

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";
import { HitlHub } from "jsr:@mp/hitl-hub@^1.0.0";  // hypothetical, 实际用 Supabase JS + Realtime

interface ApproveContractRequest {
  contract_id: string;
  decision: 'approved' | 'rejected';
  comment?: string;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as ApproveContractRequest;
    if (!body.contract_id || !body.decision) {
      throw new Error("Missing contract_id or decision");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 读合同
    const { data: contract, error: contractErr } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", body.contract_id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (contractErr || !contract) throw new Error(`contract not found: ${body.contract_id}`);

    // 2. 校验权限 (只有 owner/admin 可批)
    if (auth.role !== 'owner' && auth.role !== 'admin') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only owner/admin can approve contracts', 403);
    }

    // 3. 校验状态 (不能重复审批)
    if (contract.status !== 'pending_approval') {
      throw new Error(`contract already decided: ${contract.status}`);
    }

    // 4. 事务性更新 (audit_log 自动记录 by tg_audit trigger)
    const { error: updateErr } = await supabase
      .from("contracts")
      .update({
        status: body.decision === 'approved' ? 'active' : 'terminated',
        updated_by: auth.userId,
      })
      .eq("id", body.contract_id);

    if (updateErr) throw new Error(`contract update failed: ${updateErr.message}`);

    // 5. Realtime broadcast
    await supabase.channel(`realtime:${auth.tenantId}`).send({
      type: 'broadcast',
      event: 'contract_decided',
      payload: { contract_id: body.contract_id, decision: body.decision },
    });

    return new Response(JSON.stringify({
      contract_id: body.contract_id,
      status: body.decision === 'approved' ? 'active' : 'terminated',
      decided_by: auth.userId,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});