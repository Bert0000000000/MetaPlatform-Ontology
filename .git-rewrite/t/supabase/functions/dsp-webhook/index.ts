// supabase/functions/dsp-webhook/index.ts (扩展)
// PRD: docs/active/prd/events-db-webhook.md §4.1
// Batch: MP-V6-EVENTS-01
// 完整路由: 10+ 表 Database Webhook 接收 + event_queue 写入 + Realtime 广播

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

const ROUTER: Record<string, (payload: WebhookEvent) => Promise<Response>> = {
  'public.orders': handleOrder,
  'public.contracts': handleContract,
  'public.hitl_requests': handleHitl,
  'public.tickets': handleTicket,
  'public.invoices': handleInvoice,
  'public.dsh_session_headers': handleDshSession,
  'public.ontology_object_types': handleOntology,
  'public.pending_object_changes': handlePendingChange,
  'public.notifications': handleNotification,
  'public.employees': handleEmployee,
  'public.departments': handleDepartment,
  'public.documents': handleDocument,
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json() as WebhookEvent;
    const key = `${payload.schema}.${payload.table}`;
    const handler = ROUTER[key];

    if (!handler) {
      console.info(`[dsp-webhook] unhandled ${key}, skipping`);
      return new Response(JSON.stringify({ status: "skipped" }), { status: 200 });
    }

    return await handler(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dsp-webhook] error: ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function enqueueEvent(payload: WebhookEvent, eventType: string, target: string, tenantId: string): Promise<Response> {
  const supabase = getSupabase();
  await supabase.from('event_queue').insert({
    tenant_id: tenantId,
    event_type: eventType,
    payload: payload.record,
    target_endpoint: target,
    next_retry_at: new Date().toISOString(),
  });
  return new Response(JSON.stringify({ status: "queued", event_type: eventType }), { status: 200 });
}

async function broadcastRealtime(tenantId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  await supabase.channel(`realtime:${tenantId}`).send({ type: 'broadcast', event, payload });
}

// ============================================================
// Handlers (10+ 表)
// ============================================================

async function handleOrder(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;

  // amount > 10k → Temporal orderApprovalWorkflow
  if (Number(r['amount']) > 10000 && r['status'] === 'pending_approval') {
    return enqueueEvent(payload, 'order.pending_approval', 'temporal:orderApprovalWorkflow', r['tenant_id'] as string);
  }

  // 普通订单 → Realtime broadcast
  await broadcastRealtime(r['tenant_id'] as string, 'order_created', { id: r['id'], order_number: r['order_number'] });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleContract(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;
  const total = Number(r['total_amount']);

  if (total > 100000 && r['status'] === 'pending_approval') {
    return enqueueEvent(payload, 'contract.pending_approval', 'temporal:contractApprovalWorkflow', r['tenant_id'] as string);
  }

  await broadcastRealtime(r['tenant_id'] as string, 'contract_created', { id: r['id'], title: r['title'] });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleHitl(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;
  await broadcastRealtime(r['tenant_id'] as string, 'hitl_request_created', {
    id: r['id'], type: r['type'], title: r['title'], timeout_at: r['timeout_at'],
  });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleTicket(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;

  if (r['priority'] === 'urgent' || r['priority'] === 'high') {
    return enqueueEvent(payload, 'ticket.urgent', 'ticket-triage', r['tenant_id'] as string);
  }

  await broadcastRealtime(r['tenant_id'] as string, 'ticket_created', { id: r['id'], ticket_number: r['ticket_number'] });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleInvoice(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;

  if (r['status'] === 'issued') {
    return enqueueEvent(payload, 'invoice.issued', 'temporal:processInvoiceWorkflow', r['tenant_id'] as string);
  }

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleDshSession(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'UPDATE') return new Response("ignored", { status: 200 });
  const r = payload.record;

  if (r['status'] === 'completed') {
    await broadcastRealtime(r['tenant_id'] as string, 'dsh_session_completed', { id: r['id'], title: r['title'] });
  }

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleOntology(payload: WebhookEvent): Promise<Response> {
  if (payload.type === 'DELETE') return new Response("ignored", { status: 200 });
  const r = payload.record;

  await broadcastRealtime(r['tenant_id'] as string, 'ontology_changed', {
    rid: r['rid'], version: r['version'], type: payload.type,
  });

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handlePendingChange(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'UPDATE') return new Response("ignored", { status: 200 });
  const r = payload.record;

  if (r['status'] === 'applied') {
    await broadcastRealtime(r['tenant_id'] as string, 'ontology_applied', { change_id: r['id'] });
  }

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleNotification(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;

  await broadcastRealtime(r['tenant_id'] as string, 'notification_new', {
    id: r['id'], title: r['title'], priority: r['priority'],
  });

  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleEmployee(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;
  await broadcastRealtime(r['tenant_id'] as string, 'employee_created', { id: r['id'], name: r['full_name'] });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleDepartment(payload: WebhookEvent): Promise<Response> {
  if (payload.type === 'DELETE') return new Response("ignored", { status: 200 });
  const r = payload.record;
  await broadcastRealtime(r['tenant_id'] as string, 'department_changed', { id: r['id'], name: r['name'] });
  return new Response(JSON.stringify({ status: "broadcast" }), { status: 200 });
}

async function handleDocument(payload: WebhookEvent): Promise<Response> {
  if (payload.type !== 'INSERT') return new Response("ignored", { status: 200 });
  const r = payload.record;

  // documents 表 INSERT → 异步触发 RAG 抽取
  return enqueueEvent(payload, 'document.created', 'rag:extract', r['tenant_id'] as string);
}