# PRD：mp-workflow（业务流程）

> **应用**：mp-workflow — 业务流程编排（基于 Temporal）
> **类别**：4. 工作流
> **对应 namespace**：mp-orchestration
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-workflow` 是 v6.0 的**业务 Workflow 编排引擎**，基于 **Temporal.io**（决策 #4）。让业务用户通过 YAML / DSL 定义长任务 / 跨服务编排，引擎负责调度 / 重试 / 状态持久化。

## 2. 核心功能

- YAML / DSL workflow 定义
- 工作流可视化（dag 视图）
- 步骤类型：API 调用 / 等待信号 / 定时 / 子 workflow / HITL
- 自动重试 + backoff
- Saga（补偿事务）
- 1 周+ 长任务（`continue-as-new`）
- 失败告警 + 自动恢复

## 3. 关键接口

```typescript
// 启动 workflow
POST /v1/workflows/start
{
  "name": "order-fulfillment",
  "version": "1.0",
  "input": { "order_id": "..." },
  "tenant_id": "..."
}
// → { workflow_id, run_id }

// 查询状态
GET /v1/workflows/:id
// → { status: 'running' | 'completed' | 'failed' | 'cancelled', result: {...} }

// 发信号（外部触发）
POST /v1/workflows/:id/signal
{ "signal_name": "approval_result", "args": { "decision": "approved" } }

// 取消

POST /v1/workflows/:id/cancel
```

## 4. 数据模型

```sql
CREATE TABLE mp_workflow.definitions (
    id           uuid PRIMARY KEY,
    tenant_id    uuid,                              -- NULL = 全局模板
    name         text NOT NULL,
    version      text NOT NULL,
    yaml_def     text NOT NULL,                     -- workflow 定义
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, version)
);

CREATE TABLE mp_workflow.instances (
    id              uuid PRIMARY KEY,
    tenant_id       uuid NOT NULL,
    definition_id   uuid NOT NULL REFERENCES mp_workflow.definitions(id),
    temporal_run_id text NOT NULL UNIQUE,           -- Temporal run id
    status          text NOT NULL,                  -- running / completed / failed / cancelled
    input           jsonb,
    output          jsonb,
    error_message   text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX workflow_instances_tenant_idx ON mp_workflow.instances (tenant_id, started_at DESC);

ALTER TABLE mp_workflow.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/workflow-api:v6.0.0-<sha>`（HTTP API）+ [temporal-worker-sdk](temporal-worker-sdk.md)（执行 worker）
- 副本：API HPA 2-10；Worker HPA 2-30
- 资源：API CPU 500m / Memory 512Mi；Worker CPU 1 / Memory 1Gi
- 入口：`api.mp-platform.local/workflow/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 启动一个 hello world workflow 跑通 |
| AC2 | YAML 定义解析 + 部署 |
| AC3 | 步骤类型全部跑通（API / 信号 / 定时 / 子 wf / HITL）|
| AC4 | Saga：失败自动补偿 |
| AC5 | 24h 长任务（`wait_condition`）|
| AC6 | 自动重试 + backoff |
| AC7 | 跨租户隔离 |
| AC8 | Workflow UI（dag 视图 + 步骤状态）|

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| [temporal-cluster](temporal-cluster.md) + [temporal-worker-sdk](temporal-worker-sdk.md) | MetaPlatform-TEMPORAL-01 |
| [mp-hitl-hub](mp-hitl-hub.md) | 自家 |
| [mp-runtime](mp-runtime.md) | 自家 |

## 8. 不做

- ❌ 自研 BPMN 引擎（用 Temporal）
- ❌ Flowable（决策 #7 抛弃）
- ❌ 工作流可视化编辑器（v6.0 仅查看）
- ❌ 跨 cluster workflow（单 cluster）

---

*PRD v1.0 — 配套 [temporal-cluster](temporal-cluster.md) / [temporal-worker-sdk](temporal-worker-sdk.md) / [mp-hitl-hub](mp-hitl-hub.md)*