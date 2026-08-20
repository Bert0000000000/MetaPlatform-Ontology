// supabase/functions/ticket-triage/index.ts
// PRD: docs/active/prd/edge-fn-17-domains.md §4.2
// Batch: MetaPlatform-EDGE-FN-01
// 客服工单自动分诊: 调 dsh support-triage preset 分析

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface TriageRequest {
  ticket_id: string;
  auto_apply?: boolean;          // 是否自动写入优先级 / assignee (默认 false, 等 HITL)
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as TriageRequest;

    if (!body.ticket_id) throw new Error("Missing ticket_id");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 读工单
    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", body.ticket_id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (ticketErr || !ticket) throw new Error(`ticket not found: ${body.ticket_id}`);

    // 2. 调 dsh support-triage preset (通过 invoke dsh runtime)
    // (这里 stub: 实际调用 dsh API)
    const triageResult = {
      category: ticket.category ?? 'general',
      priority: ticket.priority === 'urgent' ? 'urgent' : (ticket.priority === 'high' ? 'high' : 'normal'),
      assignee_id: null,
      rationale: `auto-triage stub: ${ticket.title.slice(0, 50)}`,
    };

    // 简单启发式: 根据标题关键词判断 priority
    const urgentKeywords = ['紧急', 'urgent', '崩溃', 'crash', '宕机', 'down', '无法', '数据丢失'];
    const highKeywords = ['报错', 'error', '失败', 'failed', '异常', 'abnormal'];
    const lowerTitle = (ticket.title + ' ' + (ticket.description ?? '')).toLowerCase();

    if (urgentKeywords.some((k) => lowerTitle.includes(k.toLowerCase()))) {
      triageResult.priority = 'urgent';
    } else if (highKeywords.some((k) => lowerTitle.includes(k.toLowerCase()))) {
      triageResult.priority = 'high';
    }

    // 3. auto_apply: 写回 (低优先级工单, 高优需要 HITL)
    if (body.auto_apply && (triageResult.priority === 'low' || triageResult.priority === 'normal')) {
      await supabase.from("tickets").update({
        priority: triageResult.priority,
        category: triageResult.category,
      }).eq("id", body.ticket_id);
    } else if (triageResult.priority === 'urgent' || triageResult.priority === 'high') {
      // 高优先级: 调 HITL Hub tool_dsh, 等用户确认 (新 schema: payload / approver_ids / deadline_at / requester_id)
      await supabase.from("hitl_requests").insert({
        tenant_id: auth.tenantId,
        type: 'tool_dsh',
        status: 'pending',
        title: `高优工单分诊: ${ticket.ticket_number}`,
        requester_id: auth.userId,
        payload: {
          ticket_id: body.ticket_id,
          suggested_priority: triageResult.priority,
          rationale: triageResult.rationale,
        },
        approver_ids: [auth.userId],
        deadline_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),  // 1h
      });
    }

    return new Response(JSON.stringify({
      ticket_id: body.ticket_id,
      triage: triageResult,
      applied: body.auto_apply === true,
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