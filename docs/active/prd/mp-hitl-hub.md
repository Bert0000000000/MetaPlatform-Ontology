# PRD：mp-hitl-hub（HITL 联动中枢）

> **应用**：mp-hitl-hub — Human-in-the-Loop 4 类联动中枢
> **类别**：3. 数字员工
> **对应 namespace**：mp-runtime
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-hitl-hub` 是 v6.0 的**HITL（Human-in-the-Loop）联动中枢**（决策 #8）。把 4 类 HITL（`workflow_saas` / `workflow_dsh` / `tool_dsh` / `action_confirm`）统一抽象，业务应用不必关心具体实现，调用 HITL Hub 即可。

## 2. 核心功能

- 4 类 HITL 抽象：
  - `workflow_saas`：走第三方 SaaS 审批（钉钉 / 飞书 / 企微）
  - `workflow_dsh`：走 dsh 数字员工对话确认
  - `tool_dsh`：走 dsh tool 调用反馈
  - `action_confirm`：走应用内置 confirm 对话框
- HITL 状态机（pending / approved / rejected / timeout）
- 超时 + 自动拒绝（默认 7 天）
- 多渠道通知（Slack / 邮件 / 钉钉）
- 决策审计（进 `audit_log`）

## 3. 关键接口

```typescript
// 发起 HITL 请求
POST /v1/hitl/requests
{
  "type": "workflow_saas",
  "tenant_id": "...",
  "workflow_id": "...",
  "approvers": ["user1", "user2"],
  "context": {...},
  "timeout_seconds": 604800
}
// → { request_id, status: 'pending', approve_url: '...' }

// 查询状态
GET /v1/hitl/requests/:id
// → { status: 'approved' | 'rejected' | 'timeout' | 'pending', decision: {...} }

// Webhook（decision 完成后）
POST <your_webhook_url>
{ "request_id": "...", "decision": "approved", "actor": "...", "comment": "..." }
```

## 4. 数据模型

```sql
CREATE TYPE hitl_type AS ENUM ('workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm');

CREATE TABLE mp_hitl.requests (
    id              uuid PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    type            hitl_type NOT NULL,
    workflow_id     text,                            -- Temporal workflow id（type=workflow_*）
    context         jsonb NOT NULL DEFAULT '{}'::jsonb,
    approvers       text[] NOT NULL,                 -- user ids
    status          text NOT NULL DEFAULT 'pending', -- pending / approved / rejected / timeout
    decision        jsonb,                           -- { actor, comment, decided_at }
    timeout_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz
);
CREATE INDEX hitl_requests_status_idx ON mp_hitl.requests (status, timeout_at)
    WHERE status = 'pending';

ALTER TABLE mp_hitl.requests ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/hitl-hub:v6.0.0-<sha>`
- 副本：HPA 2-10
- 资源：CPU 500m / Memory 512Mi
- 入口：`api.mp-platform.local/hitl/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 发起 workflow_saas HITL 请求并走完审批 |
| AC2 | 4 种 type 全部跑通 |
| AC3 | 超时自动 reject（设置 10s 超时验证）|
| AC4 | webhook 回调成功 |
| AC5 | 多租户隔离 |
| AC6 | Slack / 邮件 / 钉钉通知送达 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| [temporal-worker-sdk](temporal-worker-sdk.md)（workflow_* 类型）| MetaPlatform-TEMPORAL-01 |
| [mp-agent-team](mp-agent-team.md)（dsh_* 类型）| 自家 |
| 第三方 SaaS 审批 API | 用户接入 |
| Slack / 邮件 webhook | 用户配置 |

## 8. 不做

- ❌ 自研审批引擎（用第三方 SaaS）
- ❌ Flowable BPMN（决策 #7 抛弃）
- ❌ 自研 IM（接第三方）
- ❌ 移动端原生 App（v6.0 不做）

---

*PRD v1.0 — 配套 [temporal-cluster](temporal-cluster.md) / [mp-agent-team](mp-agent-team.md) / [mp-workflow](mp-workflow.md)*