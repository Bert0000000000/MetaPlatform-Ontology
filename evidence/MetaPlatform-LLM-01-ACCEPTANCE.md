# MetaPlatform-LLM-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 API key 注入 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-LLM-01.md](../batch/MetaPlatform-LLM-01.md)
> **关联 PRD**：[llm-providers.md](../prd/llm-providers.md)
> **前置依赖**：MetaPlatform-DSH-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/llm-providers.md, 10 节)
- [x] dsh LLM config (`apps/dsh-web/config/llm.yml` — 已在 DSH-01 创建)
  - [x] DeepSeek primary + OpenAI secondary + Anthropic tertiary
  - [x] rate_limit + circuit_breaker + token_meter + OTel span attributes
- [x] `public.dsh_token_usage` 表 (按月分区 + RLS + 索引)
  - [x] service_role 写 + tenant 读
  - [x] input/output tokens + cost_usd + duration_ms + preset
- [x] `public.llm_pricing` 表 (默认价格)
  - [x] DeepSeek $0.00014/$0.00028 per 1k tokens
  - [x] OpenAI $0.00015/$0.00060
  - [x] Anthropic $0.00300/$0.01500
- [x] Provider Manager TypeScript 包 (`packages/mp-llm-client/`)
  - [x] `TokenBucketLimiter` (requests/min + tokens/min)
  - [x] `SimpleCircuitBreaker` (failure threshold + cooldown)
  - [x] `ProviderManager.chat()` (fallback chain + rate limit + circuit)
- [x] 单元测试 (4 cases: limiter / circuit breaker / primary success / rate limit fallback)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] 申请 DeepSeek / OpenAI / Anthropic API keys
- [ ] 通过 ExternalSecret 注入 (DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)
- [ ] `supabase db push` 应用 token_usage migration
- [ ] ProviderManager 集成到 dsh runtime
- [ ] 端到端测试:
  - [ ] DeepSeek 调用成功 → token_usage 写入 → cost_usd 估算
  - [ ] DeepSeek 限流 → 自动 fallback OpenAI
  - [ ] DeepSeek 故障 → circuit breaker open → fallback OpenAI
  - [ ] Anthropic tertiary (默认 disabled, 手动启用)
- [ ] Prometheus 验证 OTel metrics (rate limit hits + circuit state)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/llm-providers.md` | PRD v1.0 (10 节) |
| `supabase/migrations/20260820190000_create_dsh_token_usage.sql` | token_usage + llm_pricing 表 |
| `packages/mp-llm-client/src/provider-manager.ts` | RateLimiter + CircuitBreaker + ProviderManager |
| `packages/mp-llm-client/{package.json, tsconfig.json}` | pnpm workspace 包 |
| `packages/mp-llm-client/tests/provider-manager.test.ts` | 5 cases |
| `evidence/MetaPlatform-LLM-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Provider 限流 | multi-source fallback chain |
| Token 成本失控 | token meter + 告警 + 预留 limit |
| Provider 故障 | circuit breaker + 自动 fallback |
| 价格变化 | llm_pricing 表可动态更新 |

## 通知下游

✅ LLM-01 骨架完成。下游可启动:
- **MetaPlatform-RAG-01** (4w) — RAGFlow + GraphRAG (使用 dsh token meter)

---

*LLM-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 2 LLM provider 就绪*