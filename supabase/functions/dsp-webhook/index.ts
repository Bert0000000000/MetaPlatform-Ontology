// supabase/functions/dsp-webhook/index.ts
// PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §6.4 (Database Webhook)
// Database Webhook receiver: Postgres trigger → Supabase Edge Function → 业务处理
//
// 用法: Supabase Dashboard 配置 Database Webhook → POST to this function on INSERT to events table

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

interface WebhookEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json() as WebhookEvent;

    // 路由: 按 table 派发
    switch (`${payload.schema}.${payload.table}`) {
      case 'public.hitl_requests':
        return await handleHitlRequest(payload);
      case 'public.tickets':
        return await handleTicketCreated(payload);
      case 'public.contracts':
        return await handleContractCreated(payload);
      default:
        // 未识别的 table: log + 200 (避免重试)
        console.info(`[dsp-webhook] unhandled ${payload.schema}.${payload.table}, skipping`);
        return new Response(JSON.stringify({ status: "skipped" }), { status: 200 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dsp-webhook] error: ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

async function handleHitlRequest(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const record = payload.record;
  console.info(`[dsp-webhook] hitl INSERT ${record['id']} type=${record['type']}`);

  // Realtime 推送 (前端 HITL 面板)
  await supabase.channel(`hitl:${record['tenant_id']}`).send({
    type: 'broadcast',
    event: 'hitl_request_created',
    payload: { id: record['id'], type: record['type'], title: record['title'] },
  });

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleTicketCreated(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const record = payload.record;
  console.info(`[dsp-webhook] ticket INSERT ${record['id']} priority=${record['priority']}`);

  // 高优先级工单自动触发 dsh 数字员工预分类
  if (record['priority'] === 'urgent' || record['priority'] === 'high') {
    // TODO: 调 dsh preset "support-triage" 处理
    console.info(`[dsp-webhook] would dispatch to dsh support-triage preset`);
  }

  return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
}

async function handleContractCreated(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });

  const record = payload.record;
  console.info(`[dsp-webhook] contract INSERT ${record['id']} status=${record['status']}`);

  // 大额合同自动走 HITL Hub 审批流 (action_confirm)
  const totalAmount = Number(record['total_amount'] ?? 0);
  if (totalAmount > 100000 && record['status'] === 'pending_approval') {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from('hitl_requests').insert({
      tenant_id: record['tenant_id'],
      type: 'workflow_saas',
      status: 'pending',
      title: `审批合同: ${record['title']}`,
      context: { contract_id: record['id'], total_amount: totalAmount },
      timeout_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),  // 7 天
    });
  }

  return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
}