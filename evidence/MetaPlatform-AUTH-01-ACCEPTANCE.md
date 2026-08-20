# MetaPlatform-AUTH-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 live-deploy + OAuth e2e)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-AUTH-01.md](../batch/MetaPlatform-AUTH-01.md)
> **关联 PRD**：[auth-jwt-rls.md](../prd/auth-jwt-rls.md)
> **前置依赖**：MetaPlatform-FOUNDATION-01 ✅

---

## 验收标准（AC）

- [x] JWT custom claims hook 实现（`supabase/migrations/20260820150000_create_auth_custom_claims_hook.sql`）
  - [x] 注入 `tenant_id` + `role` claims 到 JWT
  - [x] 默认 `role='member'` 兜底
  - [x] grant execute to supabase_auth_admin
- [x] `_template-auth` Edge Function 模板（`supabase/functions/_template-auth/index.ts`）
  - [x] `verifyAuth(req)` 解析 Bearer token
  - [x] 返回 `AuthContext` (userId / tenantId / role / email)
  - [x] `AuthError` 类型 + `authErrorResponse()` helper
- [x] 钉钉 OAuth 集成（`supabase/functions/oauth-dingtalk-callback/index.ts`）
  - [x] OAuth 2.0 code → access_token → userinfo
  - [x] supabase.auth.admin.createUser / generateLink
  - [x] 重定向到前端 `/oauth/callback?token_hash=...`
- [x] 单元测试（`tests/auth/custom_claims_hook.test.ts`，4 cases）
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] 部署 Supabase Auth (mp-data ns) + 配 2 副本 + HPA
- [ ] Supabase Dashboard 启用 custom_access_token_hook (选 `public.custom_access_token_hook`)
- [ ] 申请钉钉 / 飞书 / 企微 OAuth app 凭证 → ExternalSecret 注入
- [ ] 端到端测试:
  - [ ] 邮箱密码登录 → JWT 含 tenant_id + role
  - [ ] 钉钉 OAuth 登录 → 自动绑定 supabase user
  - [ ] 跨 tenant SELECT 被 RLS 拒
  - [ ] OAuth callback URL 注册到钉钉后台

## 已交付文件

| 文件 | 说明 |
|---|---|
| `supabase/migrations/20260820150000_create_auth_custom_claims_hook.sql` | JWT custom_access_token_hook |
| `supabase/functions/_template-auth/index.ts` | 业务 Edge Function 复用模板 |
| `supabase/functions/oauth-dingtalk-callback/index.ts` | 钉钉 OAuth 2.0 callback |
| `tests/auth/custom_claims_hook.test.ts` | 4 cases (注入/默认/缺失/保留) |
| `docs/active/batch/MetaPlatform-AUTH-01.md` | Batch 任务文档 |
| `docs/active/prd/auth-jwt-rls.md` | PRD v1.0 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| RLS 写错导致泄露 | rls-check CI 强制 (19 CREATE TABLE, all RLS) |
| OAuth provider 限流 | 三家互备 (钉钉/飞书/企微) |
| JWT 泄露 | httpOnly + 短期 + refresh token 轮转 |

## 通知下游

✅ AUTH-01 骨架完成。下游可启动:
- **MetaPlatform-HITL-HUB-01** (4w) — JWT 验证模板就绪
- **MetaPlatform-DSH-01** (4w) — dsh Web 用 JWT 调 Supabase
- **MetaPlatform-ONTOLOGY-GEN-01** (4w) — apply-ontology-change Edge Function 用 _template-auth

---

*AUTH-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 1 Auth 层就绪*