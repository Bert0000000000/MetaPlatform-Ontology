# PRD：mp-agent-team（dsh 编排）

> **应用**：mp-agent-team — 数字员工 / Agent 团队编排
> **类别**：3. 数字员工
> **对应 namespace**：mp-runtime
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-agent-team` 是 v6.0 数字员工平台的**主入口**，承载 7 个 dsh preset（数字员工）。基于 **dsh（DeepSeek Harness, Cordis 插件框架）**（决策 #2），让业务用户通过 Web UI 与数字员工交互。

## 2. 核心功能

- 7 个 dsh preset：客服 / 销售 / HR / 财务 / 法务 / IT / 运营
- Agent 多轮对话（session 持久化）
- Tool 注册与调用（dsh `tools`）
- Subagent 协作（dsh `subagent`）
- Skill 系统（dsh `skill`）
- Session 共享（Postgres backend，K8s 多副本）
- 数字员工市场（mp-skill-marketplace 联动）

## 3. 关键接口

```typescript
// 启动新 session
POST /v1/agent/sessions
{ "preset": "customer-service", "tenant_id": "...", "initial_message": "..." }
// → { session_id, websocket_url }

// WebSocket 双向通信
WS /v1/agent/sessions/:id/ws
// 上行: { "type": "message", "content": "..." }
// 下行: { "type": "message", "content": "...", "tool_calls": [...] }

// 历史 session 列表
GET /v1/agent/sessions?tenant_id=...&limit=50

// Tool 调用审计
GET /v1/agent/sessions/:id/tools
```

## 4. 数据模型

```sql
CREATE TABLE mp_agent_team.sessions (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
    user_id      uuid NOT NULL REFERENCES auth.users(id),
    preset       text NOT NULL,                       -- preset name
    status       text NOT NULL DEFAULT 'active',     -- active / archived
    title        text,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz
);

CREATE TABLE mp_agent_team.messages (
    id           bigserial PRIMARY KEY,
    session_id   uuid NOT NULL REFERENCES mp_agent_team.sessions(id) ON DELETE CASCADE,
    role         text NOT NULL,                       -- user / assistant / tool
    content      text NOT NULL,
    tool_calls   jsonb,
    tool_results jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- dsh Postgres backend（KV 存储，K8s 多副本共享）
CREATE TABLE mp_agent_team.dsh_kv (
    key          text PRIMARY KEY,
    value        jsonb NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mp_agent_team.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/dsh-web:v6.0.0-<sha>`（来自 [dsh-image-spec](dsh-image-spec.md)）
- 副本：HPA 3-30（WebSocket 长连接）
- 资源：CPU 1 / Memory 2Gi
- 入口：`api.mp-platform.local/agent/v1` + WebSocket
- Postgres backend：复用 Supabase PG（专用 schema `mp_agent_team`）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 启动一个 customer-service session 跑通 |
| AC2 | 多轮对话：用户 → agent → tool call → response 链路 |
| AC3 | Session 持久化：关闭浏览器重开能恢复 |
| AC4 | K8s 多副本：会话粘到特定副本（或 Postgres backend 共享）|
| AC5 | Subagent 协作跑通（一个数字员工调用另一个）|
| AC6 | 跨租户隔离 |
| AC7 | 工具调用审计：`mp_agent_team.messages.tool_calls` 完整记录 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| dsh 框架 | dsh 官方 |
| Supabase PG | MP-V6-FOUNDATION-01 |
| [dsh-image-spec](dsh-image-spec.md) | MP-V6-DSH-DOCKER-01 |

## 8. 不做

- ❌ 自研 agent loop（用 dsh core/agent-loop）
- ❌ LangChain / LangGraph（决策 #19 抛弃）
- ❌ 模型微调（v6.0 不做）
- ❌ 多模态（图像 / 语音）：v6.1 引入

---

*PRD v1.0 — 配套 [dsh-image-spec](dsh-image-spec.md) / [temporal-worker-sdk](temporal-worker-sdk.md) / [mp-hitl-hub](mp-hitl-hub.md)*