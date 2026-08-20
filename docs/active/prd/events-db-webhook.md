# PRD：events-db-webhook

> **模块**：Database Webhook + pg_cron worker（事件可靠传递层）
> **对应 Batch**：[MetaPlatform-EVENTS-01](../batch/MetaPlatform-EVENTS-01.md)
> **状态**：Draft v1.0
> **负责人**：SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

实现 v6.0 事件可靠传递层，替代 v3.0 Kafka + Outbox + DLQ。Supabase Database Webhook（trigger → HTTP）+ pg_cron 定时 worker + 事件队列 + 重试 + DLQ。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 Kafka + Outbox + DLQ，治理债高
- v6.0 切到 Postgres trigger + Webhook + pg_notify + Realtime（决策 #5，spec §1.1）
- 这是 v3.0 Kafka 的替代方案

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | Database Webhook 配置（≥ 5 个 trigger） |
| G2 | dsp-webhook Edge Function 完整路由（10+ 表） |
| G3 | pg_cron 定时 worker（清理 / 备份 / 健康检查） |
| G4 | 事件队列 + 重试 + DLQ |
| G5 | Realtime 广播集成 |

## 3. 触发器清单（v6.0 全部 trigger）

| 表 | 触发事件 | 接收方 |
|---|---|---|
| `public.orders` | INSERT (status='pending_approval') | orderApprovalWorkflow |
| `public.contracts` | INSERT (status='pending_approval' AND total > 100k) | contractApprovalWorkflow + HITL |
| `public.hitl_requests` | INSERT | Realtime broadcast |
| `public.tickets` | INSERT (priority IN 'urgent','high') | ticket-triage + HITL |
| `public.dsh_session_headers` | UPDATE (status='completed') | Realtime broadcast |
| `public.invoices` | INSERT (status='issued') | processInvoiceWorkflow |
| `public.ontology_object_types` | INSERT/UPDATE (after HITL) | Realtime schema refresh |
| `public.pending_object_changes` | UPDATE (status='applied') | Realtime broadcast |
| `public.audit_log` | INSERT | （内部审计用, 不外发） |
| `public.notifications` | INSERT | Realtime + 可选 Email |

## 4. 功能需求

### 4.1 dsp-webhook 完整路由

```typescript
// supabase/functions/dsp-webhook/index.ts (扩展)
switch (`${payload.schema}.${payload.table}`) {
  case 'public.orders': return handleOrder(payload);
  case 'public.contracts': return handleContract(payload);
  case 'public.hitl_requests': return handleHitl(payload);
  case 'public.tickets': return handleTicket(payload);
  case 'public.invoices': return handleInvoice(payload);
  case 'public.dsh_session_headers': return handleDshSession(payload);
  case 'public.ontology_object_types': return handleOntology(payload);
  case 'public.pending_object_changes': return handlePendingChange(payload);
  case 'public.notifications': return handleNotification(payload);
  default: return skipped();
}
```

### 4.2 事件队列 + 重试 + DLQ

```sql
CREATE TABLE public.event_queue (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL,
    event_type      text NOT NULL,
    payload         jsonb NOT NULL,
    target_endpoint text NOT NULL,
    status          text DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dlq')),
    attempts        int DEFAULT 0,
    max_attempts    int DEFAULT 5,
    last_error      text,
    next_retry_at   timestamptz,
    delivered_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_queue_pending_idx ON public.event_queue (status, next_retry_at)
    WHERE status IN ('pending', 'failed');
```

### 4.3 pg_cron 定时 worker

| Cron | 频率 | 任务 |
|---|---|---|
| `event-retry` | 每 5 分钟 | 处理 pending + failed event_queue |
| `event-dlq-cleanup` | 每天 | 7 天前的 DLQ 事件归档冷存储 |
| `audit-log-cleanup` | 每周 | 2 年前的 audit_log 归档冷存储 (按 compliance) |
| `db-health-check` | 每小时 | 表大小 / 索引膨胀 / 慢查询 |
| `webhook-delivery-stats` | 每小时 | 上报 webhook 成功/失败率到 Prometheus |

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 延迟 | trigger → webhook 接收 < 1s p95 |
| 重试 | 指数 backoff (1s / 5s / 30s / 5min / 30min) |
| DLQ | 5 次失败后入 DLQ, 7 天后冷存储 |
| 监控 | Prometheus 暴露 delivered/failed/dlq 数 |

## 6. 接口契约

### 6.1 Database Webhook 输入

```json
{
  "type": "INSERT",
  "table": "orders",
  "schema": "public",
  "record": { "id": "uuid", "tenant_id": "uuid", "status": "pending_approval", ... },
  "old_record": null
}
```

### 6.2 dsp-webhook 输出

```json
{ "status": "ok" | "skipped" | "broadcast" | "queued" }
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 5+ trigger 配置 | Supabase Dashboard |
| AC2 | dsp-webhook 路由 10+ 表 | 单元测试 |
| AC3 | pg_cron worker 5+ cron | `SELECT * FROM cron.job;` |
| AC4 | 事件队列 + 重试 + DLQ | 集成测试 |
| AC5 | Realtime 广播 | E2E 测试 |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| pg_cron extension | Supabase 默认 |
| Realtime | MetaPlatform-FOUNDATION-01 ✅ |
| Supabase Storage (冷存储) | MetaPlatform-FOUNDATION-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| Webhook 失败 | 重试 + DLQ |
| pg_cron 错过 | 多副本 + 监控 |
| Trigger 性能 | 轻量 trigger (只写 event_queue) + 异步 worker |

## 10. 不做

- ❌ Kafka（v3.0 抛弃）
- ❌ 跨 region 复制（v6.0 单 region）
- ❌ 事件溯源（v6.1 评估）

---

*PRD v1.0 — 配套 [MetaPlatform-EVENTS-01 Batch](../batch/MetaPlatform-EVENTS-01.md)*