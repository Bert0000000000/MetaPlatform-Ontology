# MetaPlatform-OBSERVABILITY-01 — M10 mp-monitoring Loop 2/3 ACCEPTED

> **状态**:✅ Loop 2/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-OBSERVABILITY-01.md](../active/batch/MetaPlatform-OBSERVABILITY-01.md)
> **关联 ADR**:[ADR-0059-mp-observability.md](../active/decisions/ADR-0059-mp-observability.md)
> **Module**:M10 mp-monitoring Grafana dashboard + Prometheus alerts
> **Commit**:(本 session)

---

## 验收标准 (Loop 2/3 — Grafana dashboard + Prometheus alerts)

| # | 标准 | 状态 |
|---|---|---|
| AC2.1 | observability/grafana-dashboards.json 存在 + 5 dashboards | ✅ |
| AC2.2 | mp-app-health / mp-digital-employee / mp-hitl / mp-temporal / mp-rag | ✅ |
| AC2.3 | 每个 dashboard 含 panels + refresh + tags | ✅ |
| AC2.4 | observability/prometheus-alerts.json 存在 + 4 groups + 7 alerts | ✅ |
| AC2.5 | mp-app-health (3 alerts) + mp-hitl (1) + mp-temporal (2) + mp-sandbox (1) | ✅ |
| AC2.6 | SQL 在 PostgreSQL 中可解析 (EXPLAIN dry-run 全部 pass) | ✅ |
| AC2.7 | 6/6 E2E PASS | ✅ |

## 5 个 Grafana dashboard (per 应用架构 §9.2)

| ID | 主题 | 关键 panel |
|---|---|---|
| `mp-app-health` | 系统总览 | Tenants, Active Installations, pg_cron, Audit 24h, EF 列表 |
| `mp-digital-employee` | 数字员工 (M15) | Active Sessions, Waiting External, Completed 24h, Status trend |
| `mp-hitl` | HITL Hub (M13) | Pending HITL, Avg Decision Time, Escalation Level ≥2, Decided by Type |
| `mp-temporal` | Temporal Workflow (M40) | Signals Pending/Sent/Failed, Worker throughput |
| `mp-rag` | RAG 检索 (M41-M45) | Embeddings 24h, Avg Embedding Latency |

## 7 个 Prometheus alert

| Group | Alert | 阈值 |
|---|---|---|
| mp-app-health | HighErrorRate | 5xx > 1% 持续 5min |
| mp-app-health | P99LatencyHigh | P99 > 3s |
| mp-app-health | PGConnectionsHigh | PG 连接 > 80 |
| mp-hitl | PendingHITLTooLong | pending > 24h 持续 30min |
| mp-temporal | WorkflowSignalFailed | failed > 0 持续 5min |
| mp-temporal | WorkflowSignalBacklog | pending 卡 5min |
| mp-sandbox | SidecarUnreachable | sidecar 不可达 5min |

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `observability/generate-dashboards.mjs` | 200 | 生成 5 dashboard JSON + 7 alert rules |
| `observability/grafana-dashboards.json` | (生成) | 5 dashboards, 25 panels |
| `observability/prometheus-alerts.json` | (生成) | 4 groups, 7 alerts |
| `e2e/monitoring-dashboards.spec.ts` | 130 | 6 个 E2E (JSON 结构 + SQL 可解析 + 表存在) |

## 架构 (PoC → 生产)

```
PoC (本 Loop 2/3):
  + observability/grafana-dashboards.json (5 dashboards)
  + observability/prometheus-alerts.json (7 alerts)
  + observability/generate-dashboards.mjs (regenerate scripts)
  + mp-monitoring-health EF (Loop 1/3) 提供数据源

生产 (Loop 3/3):
  + OTel SDK (Deno) → trace + metric 导出 OTel Collector
  + Grafana Helm Deployment 加载 dashboards JSON
  + Prometheus Pod 加载 alerts
  + Alertmanager 通知 (Slack / 邮件 / 钉钉)
```

## 下一步 (Loop 3/3)

- OTel SDK 集成 (Deno + @opentelemetry/sdk-node)
- Trace: mp-sandbox-execute → sidecar → child_process 一条龙
- Metric: EF 请求计数 + 延迟 + 状态码
- Alertmanager + 钉钉 webhook 通知

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M10 Loop 1/3 mp-monitoring-health | 本 Loop 2/3 数据源 (subsystem health 进入 dashboard) |
| M13 HITL Hub | dashboard 4 panels + alert 1 (pending > 24h) |
| M40 Workflow | dashboard 4 panels + alert 2 (信号失败/卡 pending) |
| M15 dsh session | dashboard 2 (M15), 3 panels (active/waiting/completed) |
| Issue #15 mp-sandbox | alert 1 (sidecar 不可达) |

---

*MetaPlatform-OBSERVABILITY-01 Loop 2/3 — 2026-08-21 — 6/6 E2E PASS, 0 bug*