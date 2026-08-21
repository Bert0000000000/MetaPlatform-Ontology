// supabase/functions/temporal-worker-consume/index.ts
// PRD:  docs/active/prd/mp-ontology.md (M40 Workflow 引擎)
// ADR:   docs/active/decisions/ADR-0052-temporal-workflow.md
// Batch: MetaPlatform-MP-WORKFLOW-01 (Loop 1/3)
//
// POST /functions/v1/temporal-worker-consume
//   body: { worker_id?: string, max_batch?: number }
//   workflow_signals 消费 worker (本地 dev mock Temporal):
//   1. SELECT workflow_signals WHERE status='pending' LIMIT max_batch
//   2. 对每条: "调 Temporal signal" (本地: 模拟成功 + 落 audit_log)
//   3. UPDATE status='sent' + sent_at
//
// 注: 本地 dev 无 Temporal cluster, mock 调用. 生产 (K8s) 调 mp-workflow-worker service
//   通过 Temporal SDK 的 Client.signal() 发 signal. EF 仅做 queue dispatch + ack 维护.
//
// Realtime 订阅: production worker 还可以通过 supabase_realtime 订阅
//   workflow_signals INSERT/UPDATE, 低延迟响应. 本 spec 重点是 HTTP 批量消费.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface ConsumeRequest {
  worker_id?: string;
  max_batch?: number;
}

interface SignalRow {
  id: string;
  workflow_id: string;
  signal_name: string;
  payload: Record<string, unknown>;
  hitl_request_id: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 模拟 Temporal signal 调用 (生产: Temporal Client.signal(workflow_id, signal_name, payload))
async function mockTemporalSignal(workflowId: string, signalName: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  // PoC: 假装成功, 1ms 延迟
  await new Promise((r) => setTimeout(r, 1));
  if (!workflowId.startsWith('OrderApproval') && !workflowId.startsWith('CustomerCreate') && !workflowId.startsWith('ContractSign') && !workflowId.startsWith('InvoiceIssue') && !workflowId.startsWith('Action')) {
    return { ok: false, error: `unknown workflow type: ${workflowId.split(':')[0]}` };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'POST only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'worker requires admin/owner role' }, 403);
    }

    let body: ConsumeRequest = {};
    try { body = await req.json() as ConsumeRequest; } catch { /* empty body OK */ }

    const maxBatch = Math.min(100, Math.max(1, body.max_batch ?? 10));
    const workerId = body.worker_id ?? 'mp-workflow-worker-local';

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. SELECT pending signals
    const { data: pending, error: qErr } = await sb
      .from('workflow_signals')
      .select('id, workflow_id, signal_name, payload, hitl_request_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(maxBatch);
    if (qErr) {
      return jsonResponse({ error: 'query_failed', message: qErr.message }, 500);
    }
    const signals = (pending ?? []) as SignalRow[];
    if (signals.length === 0) {
      return jsonResponse({ ok: true, worker_id: workerId, consumed: 0, sent: 0, failed: 0 }, 200);
    }

    // 2. 对每条: 调 Temporal (mock) + UPDATE status
    const results = { sent: [] as string[], failed: [] as { id: string; error: string }[] };
    for (const sig of signals) {
      const r = await mockTemporalSignal(sig.workflow_id, sig.signal_name, sig.payload);
      if (r.ok) {
        await sb
          .from('workflow_signals')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', sig.id);
        results.sent.push(sig.id);
      } else {
        await sb
          .from('workflow_signals')
          .update({ status: 'failed', error: r.error ?? 'unknown' })
          .eq('id', sig.id);
        results.failed.push({ id: sig.id, error: r.error ?? 'unknown' });
      }
    }

    return jsonResponse({
      ok: true,
      worker_id: workerId,
      consumed: signals.length,
      sent: results.sent.length,
      failed: results.failed.length,
      sent_ids: results.sent,
      failed_details: results.failed,
      note: 'PoC: mock Temporal. 生产由 mp-workflow-worker (K8s Deployment) 调 Temporal SDK.',
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});