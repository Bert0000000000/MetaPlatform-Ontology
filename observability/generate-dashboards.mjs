// observability/grafana-dashboards.json
// MetaPlatform M10 Loop 2/3 — Grafana dashboards (5 dashboard per 应用架构 §9.2)
//
// 本地 dev: 不实际起 Grafana, 仅 JSON 格式 + Schema 验证
// 生产: mp-monitoring K8s Deployment 加载这些 dashboard JSON
//
// 5 dashboard:
//   1. mp-app-health: 各 EF QPS / 错误率 / P99 延迟
//   2. mp-digital-employee: dsh session 活跃 / LLM token / 长任务
//   3. mp-hitl: pending HITL / 平均审批时长 / SaaS 失败率
//   4. mp-temporal: workflow throughput / Activity 失败率 / 长任务数
//   5. mp-rag: 检索延迟 / KG 节点数 / 命中率

const dashboards = {
  "version": "1.0",
  "dashboards": [
    {
      "id": "mp-app-health",
      "title": "MetaPlatform · 应用健康",
      "tags": ["mp", "health", "v6.0"],
      "timezone": "browser",
      "schemaVersion": 39,
      "version": 1,
      "refresh": "30s",
      "time": { "from": "now-1h", "to": "now" },
      "panels": [
        { "id": 1, "type": "stat", "title": "Total Tenants", "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.tenants", "refId": "A" }] },
        { "id": 2, "type": "stat", "title": "Active Installations", "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM mp_preset_registry.installs WHERE status = 'active'", "refId": "A" }] },
        { "id": 3, "type": "timeseries", "title": "Audit Log 24h", "gridPos": { "x": 0, "y": 4, "w": 12, "h": 6 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.audit_log WHERE occurred_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 4, "type": "stat", "title": "pg_cron Active Jobs", "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM cron.job WHERE active = true", "refId": "A" }] },
        { "id": 5, "type": "table", "title": "EF 列表 (with RLS)", "gridPos": { "x": 0, "y": 10, "w": 18, "h": 8 },
          "targets": [{ "expr": "SELECT proname AS ef_name, pronamespace FROM pg_proc WHERE pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg_temp_%') ORDER BY proname", "refId": "A" }] },
      ],
    },
    {
      "id": "mp-digital-employee",
      "title": "MetaPlatform · 数字员工 (dsh)",
      "tags": ["mp", "dsh", "M15", "v6.0"],
      "refresh": "30s",
      "time": { "from": "now-1h", "to": "now" },
      "panels": [
        { "id": 1, "type": "stat", "title": "Active Sessions", "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.dsh_session_headers WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external')", "refId": "A" }] },
        { "id": 2, "type": "stat", "title": "Waiting External", "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.dsh_session_headers WHERE status = 'waiting_external'", "refId": "A" }] },
        { "id": 3, "type": "stat", "title": "Completed (24h)", "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.dsh_session_headers WHERE status = 'completed' AND completed_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 4, "type": "timeseries", "title": "Sessions by Status (24h 趋势)", "gridPos": { "x": 0, "y": 4, "w": 12, "h": 6 },
          "targets": [{ "expr": "SELECT date_trunc('hour', updated_at) AS hour, status, COUNT(*) FROM public.dsh_session_headers WHERE updated_at > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 1", "refId": "A" }] },
      ],
    },
    {
      "id": "mp-hitl",
      "title": "MetaPlatform · HITL Hub",
      "tags": ["mp", "hitl", "M13", "v6.0"],
      "refresh": "30s",
      "time": { "from": "now-24h", "to": "now" },
      "panels": [
        { "id": 1, "type": "stat", "title": "Pending HITL", "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.hitl_requests WHERE status = 'pending'", "refId": "A" }] },
        { "id": 2, "type": "stat", "title": "Avg Decision Time (24h)", "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT AVG(EXTRACT(EPOCH FROM (decided_at - created_at)))::int FROM public.hitl_requests WHERE decided_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 3, "type": "stat", "title": "Escalation Level ≥ 2", "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.hitl_requests WHERE escalation_level >= 2 AND status = 'pending'", "refId": "A" }] },
        { "id": 4, "type": "timeseries", "title": "HITL Decided by Type", "gridPos": { "x": 0, "y": 4, "w": 12, "h": 6 },
          "targets": [{ "expr": "SELECT date_trunc('hour', decided_at) AS hour, type, COUNT(*) FROM public.hitl_requests WHERE decided_at > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 1", "refId": "A" }] },
        { "id": 5, "type": "stat", "title": "Workflow Signals Pending", "gridPos": { "x": 12, "y": 4, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'pending'", "refId": "A" }] },
      ],
    },
    {
      "id": "mp-temporal",
      "title": "MetaPlatform · Temporal Workflow",
      "tags": ["mp", "temporal", "M40", "v6.0"],
      "refresh": "1m",
      "time": { "from": "now-1h", "to": "now" },
      "panels": [
        { "id": 1, "type": "stat", "title": "Signals Pending", "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'pending'", "refId": "A" }] },
        { "id": 2, "type": "stat", "title": "Signals Sent (24h)", "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'sent' AND sent_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 3, "type": "stat", "title": "Signals Failed (24h)", "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'failed' AND sent_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 4, "type": "timeseries", "title": "Worker 处理 throughput", "gridPos": { "x": 0, "y": 4, "w": 18, "h": 6 },
          "targets": [{ "expr": "SELECT date_trunc('minute', sent_at) AS minute, COUNT(*) FROM public.workflow_signals WHERE sent_at > now() - interval '1 hour' GROUP BY 1 ORDER BY 1", "refId": "A" }] },
      ],
    },
    {
      "id": "mp-rag",
      "title": "MetaPlatform · RAG 检索",
      "tags": ["mp", "rag", "M41-M45", "v6.0"],
      "refresh": "1m",
      "time": { "from": "now-1h", "to": "now" },
      "panels": [
        { "id": 1, "type": "stat", "title": "Embeddings (24h)", "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT COUNT(*) FROM public.image_embeddings WHERE created_at > now() - interval '24 hours'", "refId": "A" }] },
        { "id": 2, "type": "stat", "title": "Avg Embedding Latency", "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
          "targets": [{ "expr": "SELECT AVG(EXTRACT(EPOCH FROM (now() - created_at)))::int FROM public.image_embeddings", "refId": "A" }] },
      ],
    },
  ],
};

import { writeFileSync } from 'node:fs';
writeFileSync('observability/grafana-dashboards.json', JSON.stringify(dashboards, null, 2));
console.log('grafana-dashboards.json written (' + dashboards.dashboards.length + ' dashboards)');

// 同步生成 Prometheus alert rules
const alerts = {
  "groups": [
    {
      "name": "mp-app-health",
      "interval": "1m",
      "rules": [
        {
          "alert": "HighErrorRate",
          "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) > 0.01",
          "for": "5m",
          "labels": { "severity": "critical", "team": "platform" },
          "annotations": { "summary": "错误率 > 1% 持续 5 分钟" },
        },
        {
          "alert": "P99LatencyHigh",
          "expr": "histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 3",
          "for": "5m",
          "labels": { "severity": "warning", "team": "platform" },
          "annotations": { "summary": "P99 > 3s" },
        },
        {
          "alert": "PGConnectionsHigh",
          "expr": "pg_stat_activity_count > 80",
          "for": "5m",
          "labels": { "severity": "warning", "team": "platform" },
          "annotations": { "summary": "PG 连接 > 80" },
        },
      ],
    },
    {
      "name": "mp-hitl",
      "interval": "1m",
      "rules": [
        {
          "alert": "PendingHITLTooLong",
          "expr": "SELECT COUNT(*) FROM public.hitl_requests WHERE status = 'pending' AND created_at < now() - interval '24 hours'",
          "for": "30m",
          "labels": { "severity": "warning", "team": "platform" },
          "annotations": { "summary": "Pending HITL > 24h" },
        },
      ],
    },
    {
      "name": "mp-temporal",
      "interval": "1m",
      "rules": [
        {
          "alert": "WorkflowSignalFailed",
          "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'failed' AND updated_at > now() - interval '5 minutes'",
          "for": "5m",
          "labels": { "severity": "critical", "team": "platform" },
          "annotations": { "summary": "Workflow signal 失败率 > 0 (5 min)" },
        },
        {
          "alert": "WorkflowSignalBacklog",
          "expr": "SELECT COUNT(*) FROM public.workflow_signals WHERE status = 'pending' AND created_at < now() - interval '5 minutes'",
          "for": "10m",
          "labels": { "severity": "warning", "team": "platform" },
          "annotations": { "summary": "Workflow signal 卡 pending > 5 min" },
        },
      ],
    },
    {
      "name": "mp-sandbox",
      "interval": "1m",
      "rules": [
        {
          "alert": "SidecarUnreachable",
          "expr": "SELECT COUNT(*) FROM public.mp_sandbox.executions WHERE created_at > now() - interval '5 minutes' AND metadata->>'sidecar_reachable' = 'false'",
          "for": "5m",
          "labels": { "severity": "critical", "team": "platform" },
          "annotations": { "summary": "mp-sandbox sidecar 不可达" },
        },
      ],
    },
  ],
};
writeFileSync('observability/prometheus-alerts.json', JSON.stringify(alerts, null, 2));
console.log('prometheus-alerts.json written (' + alerts.groups.reduce((s, g) => s + g.rules.length, 0) + ' alerts)');