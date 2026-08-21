# PRD：mp-approval（BPMN 兜底）

> **应用**：mp-approval — 审批流兜底（BPMN 仅供特殊场景）
> **类别**：4. 工作流
> **对应 namespace**：mp-orchestration
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-approval` 是 v6.0 的**BPMN 兜底**（仅供特殊场景）。决策 #7：默认审批走**第三方 SaaS**（钉钉 / 飞书 / 企微），仅当业务流程**强 BPMN 语义**（如复杂状态机 / 并行网关）时使用此服务。Flowable 引擎不引入；用轻量级状态机引擎自研。

## 2. 核心功能

- BPMN 2.0 子集（仅 user task / exclusive gateway / parallel gateway / timer）
- 状态机持久化（PG）
- 任务分配（按角色 / 按候选人）
- 任务超时 + 自动跳过
- 任务历史查询

## 3. 关键接口

```typescript
// 部署流程定义
POST /v1/approval/definitions
{ "name": "...", "bpmn_xml": "..." }

// 启动流程实例
POST /v1/approval/instances
{ "definition_id": "...", "business_key": "...", "input": {...} }

// 查询任务
GET /v1/approval/tasks?assignee=user1

// 完成任务
POST /v1/approval/tasks/:id/complete
{ "decision": "approved", "comment": "..." }
```

## 4. 数据模型

```sql
CREATE TABLE mp_approval.definitions (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    bpmn_xml     text NOT NULL,
    version      int NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, version)
);

CREATE TABLE mp_approval.instances (
    id              uuid PRIMARY KEY,
    tenant_id       uuid NOT NULL,
    definition_id   uuid NOT NULL REFERENCES mp_approval.definitions(id),
    business_key    text,
    state           jsonb NOT NULL,                  -- 当前节点 + 变量
    status          text NOT NULL,                   -- running / completed / failed
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

CREATE TABLE mp_approval.tasks (
    id           uuid PRIMARY KEY,
    instance_id  uuid NOT NULL REFERENCES mp_approval.instances(id) ON DELETE CASCADE,
    name         text NOT NULL,
    assignee     text,
    status       text NOT NULL DEFAULT 'pending',    -- pending / completed / timeout
    due_at       timestamptz,
    completed_at timestamptz,
    decision     jsonb
);

ALTER TABLE mp_approval.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/approval:v6.0.0-<sha>`
- 副本：HPA 2-5（流量小）
- 资源：CPU 500m / Memory 512Mi
- 入口：`api.mp-platform.local/approval/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 部署一个简单 BPMN 流程跑通 |
| AC2 | exclusive / parallel gateway 跑通 |
| AC3 | user task 分配 + 完成 |
| AC4 | 任务超时自动跳过（验证）|
| AC5 | 跨租户隔离 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MetaPlatform-FOUNDATION-01 |

## 8. 不做

- ❌ **Flowable BPMN 引擎**（决策 #7 抛弃）
- ❌ **完整 BPMN 2.0**（只支持子集）
- ❌ 自研 IM 集成（用 [mp-hitl-hub](mp-hitl-hub.md) 接第三方 SaaS）
- ❌ 移动端审批（v6.0 仅 Web）

---

*PRD v1.0 — 配套 [mp-workflow](mp-workflow.md) / [mp-hitl-hub](mp-hitl-hub.md)*