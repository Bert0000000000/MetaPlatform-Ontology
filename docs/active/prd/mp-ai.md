# PRD：mp-ai（模型网关）

> **应用**：mp-ai — LLM 模型网关
> **类别**：2. AI 能力
> **对应 namespace**：mp-ai
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-ai` 是 v6.0 的**统一 LLM 网关**，对应用屏蔽多 LLM provider 差异。基于 **dsh 的 llm-pi-ai + llm-deepseek provider**（决策 #3），支持：

- 多 provider 路由（DeepSeek / OpenAI / Anthropic / 自托管）
- Token 用量计量（`token-meter`）
- 失败重试（`llm-retry`）
- 流式响应（SSE）
- Function calling 标准化

## 2. 核心功能

- 多 LLM provider 统一 API（OpenAI 兼容协议）
- Token 配额（per tenant / per user）
- 实时用量统计 + 告警
- 自动 fallback（provider 不可用时切备用）
- Streaming（SSE）
- Function calling + Tool 标准化
- Prompt 模板管理

## 3. 关键接口

```typescript
// 统一 LLM 调用（OpenAI 兼容）
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "model": "deepseek-chat",
  "messages": [...],
  "stream": true,
  "tools": [...],
  "tenant_id": "..."    // 强制
}

// Token 用量查询
GET /v1/usage?tenant_id=xxx&from=2026-01-01&to=2026-01-31

// 模型列表
GET /v1/models
```

## 4. 数据模型

```sql
CREATE TABLE mp_ai.usage_log (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL,
    actor_id        uuid,
    provider        text NOT NULL,            -- deepseek / openai / anthropic
    model           text NOT NULL,
    prompt_tokens   int NOT NULL,
    completion_tokens int NOT NULL,
    total_tokens    int NOT NULL,
    latency_ms      int NOT NULL,
    status          text NOT NULL,            -- ok / failed
    error_message   text,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_log_tenant_time_idx ON mp_ai.usage_log (tenant_id, occurred_at DESC);

CREATE TABLE mp_ai.tenant_quota (
    tenant_id       uuid PRIMARY KEY REFERENCES public.tenants(id),
    monthly_token_limit bigint NOT NULL,
    monthly_tokens_used bigint NOT NULL DEFAULT 0,
    reset_at        timestamptz NOT NULL
);
ALTER TABLE mp_ai.usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_ai.tenant_quota ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/ai-gateway:v6.0.0-<sha>`（基于 dsh）
- 副本：HPA 3-20（QPS）
- 资源：CPU 1 / Memory 1Gi
- 入口：`api.mp-platform.local/ai/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 调用 DeepSeek chat completion 成功（OpenAI 兼容）|
| AC2 | 流式响应 SSE 跑通（curl -N 看到增量数据）|
| AC3 | Token 用量实时记入 `usage_log` + `tenant_quota` |
| AC4 | 配额耗尽自动 429 拒绝 |
| AC5 | Fallback 测试（关掉 DeepSeek，自动切 OpenAI）|
| AC6 | Function calling：tool call → tool result → final response 链路跑通 |
| AC7 | 多租户隔离：tenant A 用量不影响 tenant B |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| DeepSeek API key | Vault |
| dsh llm-pi-ai provider | dsh 官方包 |
| OTel | MetaPlatform-OBSERVABILITY-01 |

## 8. 不做

- ❌ 自研模型路由算法（用 dsh token-meter）
- ❌ 模型 fine-tuning（v6.0 不做）
- ❌ 训练数据存储（v6.0 不做）
- ❌ LangChain 集成（决策 #19 抛弃）

---

*PRD v1.0 — 配套 [otel-collector-config](otel-collector-config.md) / [temporal-worker-sdk](temporal-worker-sdk.md)*