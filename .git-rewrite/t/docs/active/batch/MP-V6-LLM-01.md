# MP-V6-LLM-01 — dsh LLM provider 详细配置

> **Batch 状态**：Pending Acceptance
> **优先级**：🟡 P2
> **工作量**：2 周
> **团队**：AI 团队
> **前置依赖**：MP-V6-DSH-01 ✅

---

## 1. 目标

为 dsh 配置多 LLM provider (DeepSeek primary + OpenAI fallback + Anthropic tertiary)，实现 rate limit / circuit breaker / token meter。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §3.2 / §7.4
- PRD（待补）：`docs/active/prd/llm-providers.md`

## 3. 核心交付

| 项 | 验证 |
|---|---|
| dsh llm-pi-ai provider 配置 | `pnpm dsh llm test` |
| DeepSeek primary + OpenAI fallback + Anthropic tertiary | config 校验 |
| Rate limit + circuit breaker | 集成测试 |
| Token meter 上报 (Postgres + OTel) | Grafana 仪表盘 |
| Provider 切换策略 | unit test |

## 4. 详细任务清单

### Week 1：Provider 集成
- [ ] dsh llm-pi-ai 集成（统一 provider 接口）
- [ ] DeepSeek primary 配置
- [ ] OpenAI fallback 配置
- [ ] Anthropic tertiary 配置（可选）

### Week 2：限流 + 监控
- [ ] Rate limit (requests/min, tokens/min)
- [ ] Circuit breaker (failure threshold + cooldown)
- [ ] Token meter → Supabase PG 表 (dsh_token_usage)
- [ ] OTel metrics 上报（prometheus scrape）
- [ ] 告警规则 (token 用量超阈值)

## 5. 验收标准（AC）

- [ ] 3 个 provider 集成
- [ ] Rate limit 生效
- [ ] Circuit breaker 验证
- [ ] Token meter → PG
- [ ] OTel metrics → Prometheus
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Provider 限流 | fallback chain + circuit breaker |
| Token 成本失控 | token meter + 告警 + 预留 limit |
| Provider 故障 | 多 provider 互备 |

---

*MP-V6-LLM-01 — Sprint 2 LLM provider 就绪*