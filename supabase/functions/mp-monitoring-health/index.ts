// supabase/functions/mp-monitoring-health/index.ts
// PRD:  docs/active/prd/mp-monitoring.md (M10 可观测层 P0)
// ADR:   docs/active/decisions/ADR-0059-mp-observability.md
// Batch: MetaPlatform-OBSERVABILITY-01 (Loop 1/3)
//
// GET /functions/v1/mp-monitoring-health
//   系统整体健康检查: 数字员工 / 沙箱 / HITL / dsh session / ontology / cron / DB
//   单一端点聚合所有子系统状态 (mp-monitoring dashboard 数据源)
//
// 返回: { ok, timestamp, version, subsystems: [{name, status, details, latency_ms}] }
//
// OTel 后续: 这个 EF 加 OTel SDK (Deno) → trace + metric 导出到 OTel Collector
//   本 PoC: 内部 health check, 不接 OTel (留 Loop 2/3)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

type Status = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

interface Subsystem {
  name: string;
  status: Status;
  latency_ms: number;
  details: Record<string, unknown>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed', message: 'GET only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const start = Date.now();
    const subsystems: Subsystem[] = [];

    // 1. PG 数据库连通性 + 主要表行数
    {
      const t0 = Date.now();
      try {
        const [tenants, sessions, hitlPending, sigPending, sigFailed, sandboxExecs24h] = await Promise.all([
          sb.from('tenants').select('id', { count: 'exact', head: true }),
          sb.from('dsh_session_headers').select('id', { count: 'exact', head: true }),
          sb.from('hitl_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          sb.from('workflow_signals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          sb.from('workflow_signals').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
          sb.from('mp_sandbox.executions').select('id', { count: 'exact', head: true }).gt('created_at', new Date(Date.now() - 86400000).toISOString()),
        ]);
        subsystems.push({
          name: 'postgres',
          status: 'healthy',
          latency_ms: Date.now() - t0,
          details: {
            tenants: tenants.count ?? 0,
            dsh_sessions: sessions.count ?? 0,
            hitl_pending: hitlPending.count ?? 0,
            workflow_signals_pending: sigPending.count ?? 0,
            workflow_signals_failed: sigFailed.count ?? 0,
            mp_sandbox_24h: sandboxExecs24h.count ?? 0,
          },
        });
      } catch (err) {
        subsystems.push({ name: 'postgres', status: 'unhealthy', latency_ms: Date.now() - t0, details: { error: (err as Error).message } });
      }
    }

    // 2. pg_cron 活跃 jobs
    {
      const t0 = Date.now();
      try {
        const r = await sb.rpc('get_cron_jobs_count' as never).then(
          (v) => v,
          async () => {
            // 直接 SQL 查询
            const r2 = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/exec_sql`, {
              method: 'POST',
              headers: {
                'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ query: "SELECT count(*)::int AS n FROM cron.job WHERE active = true" }),
            });
            return r2.ok ? await r2.json() : [{ n: 0 }];
          }
        );
        const n = (r as unknown as { data?: Array<{ n: number }> }).data?.[0]?.n ?? 0;
        subsystems.push({ name: 'pg_cron', status: n > 0 ? 'healthy' : 'degraded', latency_ms: Date.now() - t0, details: { active_jobs: n } });
      } catch (err) {
        subsystems.push({ name: 'pg_cron', status: 'unknown', latency_ms: Date.now() - t0, details: { error: (err as Error).message } });
      }
    }

    // 3. Edge Functions runtime (自检)
    {
      const t0 = Date.now();
      subsystems.push({
        name: 'edge_functions',
        status: 'healthy',
        latency_ms: Date.now() - t0,
        details: { runtime: 'deno', version: Deno.version.deno, ef: 'mp-monitoring-health' },
      });
    }

    // 4. Realtime (publication 状态)
    {
      const t0 = Date.now();
      try {
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: "SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime'" }),
        });
        const tables = r.ok ? ((await r.json() as unknown as { n: number }[]).length > 0 ? (await r.json() as unknown as { n: number }[])[0].n : 0) : 0;
        subsystems.push({ name: 'realtime', status: tables > 0 ? 'healthy' : 'degraded', latency_ms: Date.now() - t0, details: { published_tables: tables } });
      } catch (err) {
        subsystems.push({ name: 'realtime', status: 'unknown', latency_ms: Date.now() - t0, details: { error: (err as Error).message } });
      }
    }

    // 5. mp-sandbox sidecar (本地 dev: docker container)
    {
      const t0 = Date.now();
      try {
        const r = await fetch('http://mp-sandbox-sidecar:9999/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'echo probe', language: 'bash', timeout_ms: 2000 }),
        });
        subsystems.push({
          name: 'mp_sandbox_sidecar',
          status: r.ok ? 'healthy' : 'degraded',
          latency_ms: Date.now() - t0,
          details: { url: 'http://mp-sandbox-sidecar:9999/execute', http_status: r.status },
        });
      } catch (err) {
        subsystems.push({ name: 'mp_sandbox_sidecar', status: 'unhealthy', latency_ms: Date.now() - t0, details: { error: (err as Error).message } });
      }
    }

    // 总体
    const allHealthy = subsystems.every(s => s.status === 'healthy');
    const anyUnhealthy = subsystems.some(s => s.status === 'unhealthy');
    const overall: Status = anyUnhealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded';

    return jsonResponse({
      ok: !anyUnhealthy,
      overall,
      timestamp: new Date().toISOString(),
      version: 'v6.0',
      total_latency_ms: Date.now() - start,
      subsystems,
      summary: {
        healthy: subsystems.filter(s => s.status === 'healthy').length,
        degraded: subsystems.filter(s => s.status === 'degraded').length,
        unhealthy: subsystems.filter(s => s.status === 'unhealthy').length,
        unknown: subsystems.filter(s => s.status === 'unknown').length,
        total: subsystems.length,
      },
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});