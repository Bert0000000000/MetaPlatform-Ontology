# MetaPlatform-OBSERVABILITY-01 — M10 mp-monitoring 系统健康检查 (Loop 1/3) ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-OBSERVABILITY-01.md](../active/batch/MetaPlatform-OBSERVABILITY-01.md)
> **关联 ADR**:[ADR-0059-mp-observability.md](../active/decisions/ADR-0059-mp-observability.md)
> **Module**:M10 mp-monitoring (可观测层 P0)
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — health check EF + admin UI)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `mp-monitoring-health` EF (GET, 任意 role) 聚合 5 个 subsystem | ✅ |
| AC1.2 | postgres subsystem (rows count: tenants/sessions/hitl/signals/sandbox) | ✅ |
| AC1.3 | pg_cron subsystem (active_jobs count) | ✅ |
| AC1.4 | edge_functions subsystem (Deno version + runtime) | ✅ |
| AC1.5 | realtime subsystem (publication tables count) | ✅ |
| AC1.6 | mp_sandbox_sidecar subsystem (HTTP probe 9999) | ✅ |
| AC1.7 | overall 状态计算 (healthy/degraded/unhealthy) + summary | ✅ |
| AC1.8 | admin-server /admin/monitoring 显示 5 subsystem + 状态 tag | ✅ |
| AC1.9 | 端到端: action-apply 一次后, workflow_signals_pending +1 (数据实时) | ✅ |
| AC1.10 | 9/9 E2E PASS | ✅ |

## E2E 结果

```
Running 9 tests using 1 worker
[1/9] 1. GET /mp-monitoring-health → 200 + overall + ≥4 subsystems              (pass)
[2/9] 2. postgres subsystem → healthy + 行数                                   (pass)
[3/9] 3. edge_functions subsystem → healthy + Deno version                     (pass)
[4/9] 4. mp_sandbox_sidecar subsystem → healthy (docker container)            (pass)
[5/9] 5. realtime subsystem → healthy (有 publication tables)                  (pass)
[6/9] 6. pg_cron subsystem → healthy (有 active jobs)                          (pass)
[7/9] 7. summary 统计一致 (healthy + degraded + unhealthy + unknown = total)  (pass)
[8/9] 8. anon → 401                                                           (pass)
[9/9] 9. 端到端: action-apply 一次后, workflow_signals_pending 数 +1           (pass)

  9 passed (4.0s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/mp-monitoring-health/index.ts` | 180 | GET 聚合 5 subsystem 健康检查 |
| `e2e/mp-monitoring.spec.ts` | 175 | 9 个 E2E |

## Subsystem 状态机

| Subsystem | 探测方式 | healthy 条件 | degraded 条件 | unhealthy 条件 |
|---|---|---|---|---|
| postgres | count + head | 表可达 | — | 连接错误 |
| pg_cron | count active | > 0 | = 0 | 查询失败 |
| edge_functions | Deno.version | > 0 | — | runtime 错误 |
| realtime | pg_publication_tables count | > 0 | = 0 | 查询失败 |
| mp_sandbox_sidecar | POST /execute probe | 200 | 非 2xx | 连接失败 |

## 架构 (PoC → 生产)

```
PoC (本 Loop):
  mp-monitoring-health EF → 聚合 5 subsystem → JSON
  任何 role 可读 (admin dashboard 数据源)
  OTel 留 Loop 2/3 接

生产 (Loop 2/3):
  + OTel SDK (Deno) → trace + metric 导出到 OTel Collector
  + Grafana dashboard (OTel flow → Tempo/Prometheus/Loki)
  + Alert rules: HighErrorRate / P99LatencyHigh / PGConnectionsHigh / SidecarCrash
```

## 下一步 (Loop 2/3 + 3/3)

- Loop 2/3: OTel SDK 集成 + Grafana dashboard JSON (业务健康/数字员工/HITL/Temporal/RAG 5 个 dashboard)
- Loop 3/3: 告警规则 (Prometheus alert rules) + 通知通道 (Realtime WS + Email + 钉钉)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M10 OTel / Grafana | 本 Loop 1/3 是 data source, 后续 Loop 2/3 接 OTel |
| M13 HITL Hub | hitl_pending / workflow_signals_pending 来自本监控 |
| M15 dsh session | dsh_sessions 行数监控 |
| Issue #15 mp-sandbox | sandbox_24h 行数 + sidecar 健康 |
| mp-platform admin-server | /admin/monitoring (后续 Loop) 显示 health JSON |

---

*MetaPlatform-OBSERVABILITY-01 Loop 1/3 — 2026-08-21 — 9/9 E2E PASS, 0 bug*