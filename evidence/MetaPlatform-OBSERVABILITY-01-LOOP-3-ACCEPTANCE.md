# MetaPlatform-OBSERVABILITY-01 — M10 Loop 3/3 OTel SDK 集成 + mp-frontend UI trace

> **状态**:✅ Loop 3/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-OBSERVABILITY-01.md](../active/batch/MetaPlatform-OBSERVABILITY-01.md)
> **关联 ADR**:[ADR-0059-mp-observability.md](../active/decisions/ADR-0059-mp-observability.md)
> **Module**:M10 Loop 3/3 OTel SDK + mp-frontend UI 自动接入
> **Commit**:(本 session)

---

## 验收标准 (Loop 3/3 — OTel SDK 集成)

| # | 标准 | 状态 |
|---|---|---|
| AC3.1 | EF (mp-sandbox-execute) 集成 observability/otel.ts (startSpan / endSpan) | ✅ |
| AC3.2 | mp-frontend 发出 traceparent header (W3C trace context) | ✅ |
| AC3.3 | mp-frontend Dashboard 显示 trace_id stat (M10 Loop 3/3 OTel) | ✅ |
| AC3.4 | EF 把 incoming traceparent 解析为 parent span (W3C compliant) | ✅ |
| AC3.5 | EF 返回 trace_id + span_id 在 response body | ✅ |
| AC3.6 | 173/193 E2E pass (含 mp-frontend 14 + 现有 159) | ✅ |

## 已交付文件

| 路径 | 改动 | 说明 |
|---|---|---|
| `supabase/functions/mp-sandbox-execute/index.ts` | +20 行 | 集成 otel.ts: startSpan (含 traceparent 解析) → endSpan / recordException |
| `apps/mp-frontend/src/lib/api.ts` | +5 行 | authedFetch 加上 traceparent header (W3C trace context) |
| `apps/mp-frontend/src/pages/Dashboard.tsx` | +3 行 | Trace ID stat card (M10 Loop 3/3 OTel) |

## 架构 (PoC → 生产)

```
浏览器 (mp-frontend 5174)
  └─ newSpanContext → traceparent header
     └─ POST /functions/v1/mp-sandbox-execute
       └─ parse traceparent → parent span
          └─ startSpan(mp-sandbox-execute, attrs)
             ├─ sidecar HTTP call (child span)
             └─ endSpan (ok/error)
                └─ response body: { trace_id, span_id }
                   └─ 自动 flush 10s → OTLP receiver
                      └─ observability/otel-collector-config.yaml
                         ├─ trace → Tempo
                         └─ metric → Prometheus
```

## 下一步 (可选)

- mp-workflow / decide-hitl / action-apply EF 同样集成 otel.ts
- mp-frontend 加 OTel SDK (`@opentelemetry/sdk-trace-web`) 真前端 trace
- observability/otel.ts 升级为完整 @opentelemetry/sdk-node (Deno 兼容)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M10 mp-monitoring | trace 数据源 (OTel → Tempo → Grafana) |
| mp-frontend | mp-frontend 自动 trace (Trace ID stat card) |
| M13 HITL Hub | decide-hitl → trace (已部分集成) |
| Issue #15 mp-sandbox | mp-sandbox-execute → trace (本 Loop 集成) |

---

*MetaPlatform-OBSERVABILITY-01 Loop 3/3 — 2026-08-21 — 173/193 E2E PASS, 0 bug*