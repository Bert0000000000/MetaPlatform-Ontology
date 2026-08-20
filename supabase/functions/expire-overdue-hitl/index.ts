// supabase/functions/expire-overdue-hitl/index.ts
// pg_cron 每小时调一次 (via Supabase pg_cron or Database Webhook trigger)
//   或由 mp-monitoring pg_cron 调度
//
// 自动 expire 超过 deadline_at 的 pending HITL:
//   - status: pending → expired
//   - 插入 workflow_signals (signal_name='hitl_expired') 让 Temporal worker 知道
//
// 后续: HITL expired 后由 Temporal workflow 决定下一步 (auto_reject / auto_escalate_forever).

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

interface ExpireResult {
  expired_count: number;
  expired_ids: string[];
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 查所有超时 pending HITL (跨 tenant, system-init)
    // 注意: 不传 Authorization header, service_role 已可读全部
    const { data: overdue, error: queryErr } = await sb
      .from('hitl_requests')
      .select('id, tenant_id, workflow_id, escalation_level, title')
      .eq('status', 'pending')
      .lt('deadline_at', new Date().toISOString())
      .limit(100);
    if (queryErr) {
      return new Response(JSON.stringify({ error: queryErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const expiredIds: string[] = [];
    for (const hitl of overdue ?? []) {
      const { error: updErr } = await sb
        .from('hitl_requests')
        .update({ status: 'expired' })
        .eq('id', hitl.id);
      if (!updErr) {
        expiredIds.push(hitl.id);
      }
    }

    const result: ExpireResult = {
      expired_count: expiredIds.length,
      expired_ids: expiredIds,
    };
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});