# MetaPlatform-AUTH-01 — Supabase Auth + RLS + JWT

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P1（Sprint 1 起点，前置依赖 HITL Hub / Ontology Gen）
> **工作量**：2 周
> **团队**：SRE + 后端
> **前置依赖**：MetaPlatform-FOUNDATION-01 ✅

---

## 1. 目标

部署 Supabase Auth（GoTrue）+ 业务 RLS policy 模板 + JWT 注入，让 dsh / Edge Functions / Temporal Worker 都能安全访问 Supabase。

## 2. 配套文档

- **技术架构 spec**：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](../../specs/2026-08-19-mp-v6-architecture.md) §3.1 / §7.2
- **PRD（待补）**：`docs/active/prd/auth-jwt-rls.md`（stub 待架构组评审）

## 3. 核心交付

| 项 | 验证 |
|---|---|
| Supabase Auth (GoTrue) 部署 | `kubectl get pods -n mp-data -l app=supabase-auth` |
| 业务表 RLS policy 全部启用 | `psql \d+ <table>` + `rls-check.sh` |
| JWT 注入 `tenant_id` + `role` claims | 单元测试 + e2e |
| Edge Function JWT 验证模板 | `supabase/functions/_template-auth/` |
| 1 个 OAuth provider（钉钉 / 飞书 / 企微 三选一） | OAuth flow e2e |

## 4. 详细任务清单

### 第 1 周：Supabase Auth + JWT claims
- [ ] 部署 supabase-auth (GoTrue)
- [ ] 配置 JWT custom claims: `tenant_id` / `role`
- [ ] 写 `supabase/migrations/<ts>_add_auth_claims.sql`
- [ ] 写 `_template-auth` Edge Function 验证模板
- [ ] 端到端测试: 注册 → 登录 → JWT 解析 → tenant_id 注入

### 第 2 周：OAuth + RLS audit
- [ ] 集成 1 个 OAuth provider (钉钉推荐)
- [ ] 写 OAuth callback Edge Function
- [ ] 跑全量 RLS audit (`rls-check.sh` 应绿)
- [ ] 端到端: OAuth 登录 → RLS 隔离生效 → 跨 tenant 访问被拒
- [ ] evidence/MetaPlatform-AUTH-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] Supabase Auth 高可用（≥ 2 副本）
- [ ] JWT 含 `tenant_id` + `role` claims
- [ ] 100% 业务表 RLS 启用（CI gate）
- [ ] Edge Function JWT 验证模板就绪
- [ ] OAuth 集成通过 e2e
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| RLS 写错导致数据泄露 | rls-check CI + 严格测试 |
| OAuth provider 限流 | 三家互备（钉钉/飞书/企微） |
| JWT 泄露 | httpOnly + 短期 + refresh token 轮转 |

## 7. 下游依赖

本 Batch 完成后可启动：
- MetaPlatform-HITL-HUB-01（依赖 JWT 解析）
- MetaPlatform-DSH-01（dsh Web 用 JWT 调 Supabase）
- MetaPlatform-ONTOLOGY-GEN-01（apply-ontology-change Edge Function）

---

*MetaPlatform-AUTH-01 — Sprint 1 Auth 层就绪*