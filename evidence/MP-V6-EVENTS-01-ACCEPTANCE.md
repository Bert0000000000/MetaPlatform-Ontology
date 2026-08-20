# MP-V6-EVENTS-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 10+ trigger 配置 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-EVENTS-01.md](../batch/MP-V6-EVENTS-01.md)
> **关联 PRD**：[events-db-webhook.md](../prd/events-db-webhook.md)
> **前置依赖**：MP-V6-FOUNDATION-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/events-db-webhook.md, 10 节)
- [x] `dsp-webhook` Edge Function 完整路由 (12+ 表)
  - [x] ROUTER map 覆盖 12 表 (orders/contracts/hitl/tickets/invoices/dsh_sessions/pending_changes/notifications/employees/departments/documents/ontology)
  - [x] INSERT / UPDATE / DELETE 都路由
  - [x] 路由策略:
    - orders: amount>10k → Temporal workflow / 普通 → Realtime broadcast
    - contracts: total>100k → Temporal workflow / 普通 → Realtime broadcast
    - hitl/tickets urgent → Temporal HITL / 普通 → Realtime broadcast
    - dsh_session completed → Realtime broadcast
    - documents → enqueue RAG extraction
- [x] `event_queue` 表 (重试 + DLQ)
  - [x] 5 次失败后入 DLQ
  - [x] index `(status, next_retry_at) WHERE status IN ('pending', 'failed')`
  - [x] RLS + tg_inject_tenant
- [x] `event_dlq` 表 (失败事件归档)
  - [x] 7 天后冷存储清理
- [x] pg_cron 5 个 worker
  - [x] `event-retry` 每 5 分钟 (`*/5 * * * *`)
  - [x] `event-dlq-cleanup` 每天 03:00
  - [x] `audit-log-cleanup` 每周日 04:00 (2 年归档, per compliance)
  - [x] `db-health-check` 每小时
  - [x] `webhook-delivery-stats` 每小时 :15
- [x] 单元测试 (`tests/events/webhook_router.test.ts`, 4 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase db push` 应用 event_queue_and_cron migration
- [ ] Supabase Dashboard 配置 12 个 Database Webhook → POST dsp-webhook
- [ ] 验证 pg_cron: `SELECT * FROM cron.job;` (应见 5+ cron)
- [ ] 端到端测试:
  - [ ] INSERT orders(amount>10k) → event_queue.enqueue → cron worker → Temporal 启动
  - [ ] 5 次失败后 → DLQ → 7 天后清理
  - [ ] Realtime broadcast 延迟 < 500ms
  - [ ] 跨 tenant event 隔离 (RLS)
- [ ] Webhook 重试: 模拟 dsp-webhook 500 → event_queue  attempts+1 + next_retry_at

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/events-db-webhook.md` | PRD v1.0 (10 节) |
| `supabase/migrations/20260820180000_create_event_queue_and_cron.sql` | event_queue + event_dlq + 5 cron |
| `supabase/functions/dsp-webhook/index.ts` | (升级) 12+ 表完整路由 |
| `tests/events/webhook_router.test.ts` | 4 cases 路由测试 |
| `docs/active/batch/MP-V6-EVENTS-01.md` | Batch doc |
| `evidence/MP-V6-EVENTS-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Webhook 失败 | 重试 (指数 backoff 1s/5s/30s/5min/30min) + DLQ |
| pg_cron 错过 | 多副本 + Prometheus 监控 cron 任务 last_run |
| Trigger 性能影响表 | trigger 轻量 (只 enqueue) + 异步 worker 投递 |
| DLQ 7 天前未清理 | cron `event-dlq-cleanup` 兜底 |

## 通知下游

✅ EVENTS-01 骨架完成。下游可启动:
- **MP-V6-LLM-01** (2w) — LLM provider 详细配置
- **MP-V6-RAG-01** (4w) — RAGFlow + GraphRAG (document.created 事件已就绪)

---

*EVENTS-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 2 事件层就绪*