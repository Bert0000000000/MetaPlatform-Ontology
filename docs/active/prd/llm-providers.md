# PRD：llm-providers

> **模块**：dsh LLM provider 详细配置（DeepSeek + OpenAI + Anthropic 多源 + 限流 + circuit breaker + token meter）
> **对应 Batch**：[MetaPlatform-LLM-01](../batch/MetaPlatform-LLM-01.md)
> **状态**：Draft v1.0
> **负责人**：AI 团队
> **日期**：2026-08-20

---

## 1. 概述（What）

实现 dsh 的多 LLM provider 详细配置：DeepSeek primary + OpenAI fallback + Anthropic tertiary，配合 rate limit / circuit breaker / token meter / OTel metrics。

## 2. 背景与目标

### 2.1 背景

- v3.0 自建 llmgw，治理债高
- v6.0 用 dsh `llm-pi-ai` provider（决策 #3，spec §1.1）
- 多 provider 互备避免限流

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 3 个 LLM provider 集成 |
| G2 | Rate limit (requests/min + tokens/min) |
| G3 | Circuit breaker (failure threshold + cooldown) |
| G4 | Token meter → dsh_token_usage 表 |
| G5 | OTel metrics → Prometheus |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| dsh 数字员工 | LLM 调用自动走 primary → fallback → tertiary |
| SRE | Prometheus 监控 token 用量 + 限流状态 + circuit breaker 状态 |

## 4. 功能需求

### 4.1 Provider 配置

（已在 `apps/dsh-web/config/llm.yml` 实现）

### 4.2 Rate Limit

```typescript
// 每分钟 requests + tokens
class RateLimiter {
  constructor(opts: { requestsPerMinute: number; tokensPerMinute: number }) {}
  async tryAcquire(): Promise<boolean>;
}
```

### 4.3 Circuit Breaker

```typescript
class CircuitBreaker {
  states: 'closed' | 'open' | 'half-open';
  failureThreshold: number;       // 默认 5
  cooldownSeconds: number;        // 默认 60
}
```

### 4.4 Token Meter

```sql
CREATE TABLE public.dsh_token_usage (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    session_id      uuid REFERENCES public.dsh_session_headers(id),
    provider        text NOT NULL,            -- 'deepseek-primary' | 'openai-secondary' | ...
    model           text NOT NULL,
    input_tokens    int NOT NULL,
    output_tokens   int NOT NULL,
    cost_usd        numeric(10, 6),          -- 估算成本
    duration_ms     int,
    preset          text,                      -- 'support-triage' | 'knowledge-curator' | ...
    occurred_at     timestamptz NOT NULL DEFAULT now()
);
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 响应 | token meter 写 PG < 10ms p99 |
| 多租户 | RLS 强制 |
| 可观测 | OTel metrics 上报 |

## 6. 接口契约

### 6.1 LLM Client SDK

```typescript
interface LlmRequest {
  provider?: string;          // 默认 primary
  model?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

interface LlmResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  provider: string;
  durationMs: number;
}
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 3 个 provider 集成 | config 校验 |
| AC2 | Rate limit 生效 | 单元测试 |
| AC3 | Circuit breaker | 单元测试 (mock failures) |
| AC4 | Token meter 写 PG | 集成测试 |
| AC5 | OTel metrics | Prometheus scrape |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| dsh llm-pi-ai | MetaPlatform-DSH-01 ✅ |
| DEEPSEEK_API_KEY | SRE 申请 + Vault |
| OPENAI_API_KEY (可选) | SRE 申请 |
| ANTHROPIC_API_KEY (可选) | SRE 申请 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| Provider 限流 | 多 provider fallback |
| Token 成本失控 | token meter + 告警 + 预留 limit |
| Provider 故障 | circuit breaker + fallback chain |

## 10. 不做

- ❌ 自建 llmgw（用 dsh llm-pi-ai）
- ❌ Provider 抽象层 over-spec（直接用 dsh 内置）
- ❌ 本地模型（v6.0 纯云端）

---

*PRD v1.0 — 配套 [MetaPlatform-LLM-01 Batch](../batch/MetaPlatform-LLM-01.md)*