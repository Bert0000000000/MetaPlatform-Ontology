// supabase/functions/temporal-worker-consume/index.ts
// PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §6.3 (M40 Workflow)
// ADR:  docs/active/decisions/ADR-0052-temporal.md
// Batch: MetaPlatform-TEMPORAL-01 (Loop 2/3)
//
// GET /functions/v1/temporal-worker-consume
//   Mp-workflow worker: 消费 workflow_signals.status='pending', 启动 Temporal workflow
//   本 PoC: mock Temporal start (生产: Temporal client.workflow.start)
//   ack workflow_signals (status: pending → sent) + 写 audit_log
//
// 生产 (Loop 3/3):
//   - Temporal client @temporalio/client.start
//   - 实际调 Temporal cluster (K8s Service: mp-temporal:7233)
//   - worker 心跳 → Realtime 推送
//
// 触发方式:
//   - pg_cron 每 30s 调 (本地 dev: ./scripts/dev/temporal-worker-cron.sh)
//   - Realtime 订阅 workflow_signals UPDATE (低延迟)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface Signal {
  id: string;
  hitl_request_id: string;
  workflow_id: string;
  signal_name: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

interface ConsumeResult {
  ok: boolean;
  consumed: number;
  succeeded: number;
  failed: number;
  results: Array<{ signal_id: string; workflow_id: string; status: 'sent' | 'failed'; error?: string }>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 模拟 Temporal client (PoC: 返回 workflow_id 而不真起 Temporal)
async function startTemporalWorkflow(workflow_id: string, signal_name: string, payload: Record<string, unknown>): Promise<{ ok: boolean; run_id?: string; error?: string }> {
  // 业务规则: hitl_decision signals must have decision ('approved' | 'rejected')
  if (signal_name === 'hitl_decision') {
    if (!payload.decision || (payload.decision !== 'approved' && payload.decision !== 'rejected')) {
      return { ok: false, error: 'invalid decision in payload' };
    }
  }
  // PoC: 100% 成功 (生产: 真实调 Temporal client)
  await new Promise((r) => setTimeout(r, 10));  // mock latency
  return { ok: true, run_id: 'run_' + Math.random().toString(36).slice(2, 10) };
}

serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'GET or POST only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'only admin/owner can run worker' }, 403);
    }

    const url = new URL(req.url, 'http://localhost');
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20') || 20));

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. 拉 pending signals (按 hitl_request_id 唯一, 避免重复)
    const { data: signals, error: queryErr } = await sb
      .from('workflow_signals')
      .select('id, hitl_request_id, workflow_id, signal_name, payload, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (queryErr) {
      return jsonResponse({ error: 'query_failed', message: queryErr.message }, 500);
    }

    const result: ConsumeResult = {
      ok: true,
      consumed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    };

    for (const sig of (signals ?? []) as Signal[]) {
      // 2. 启动 Temporal workflow (mock)
      const temporal = await startTemporalWorkflow(sig.workflow_id, sig.signal_name, sig.payload);

      // 3. 更新 signal status
      if (temporal.ok) {
        await sb
          .from('workflow_signals')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', sig.id);
        result.succeeded++;
        result.results.push({ signal_id: sig.id, workflow_id: sig.workflow_id, status: 'sent' });
      } else {
        await sb
          .from('workflow_signals')
          .update({ status: 'failed', error: temporal.error ?? 'unknown' })
          .eq('id', sig.id);
        result.failed++;
        result.results.push({ signal_id: sig.id, workflow_id: sig.workflow_id, status: 'failed', error: temporal.error });
      }
      result.consumed++;
    }

    return jsonResponse(result, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});