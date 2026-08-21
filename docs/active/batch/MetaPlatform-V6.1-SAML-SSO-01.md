# docs/active/batch/MetaPlatform.1-SAML-SSO-01.md (实际文件: v6.1 batch doc 写在下文)
# MetaPlatform.1-SAML-SSO-01 — v6.1 SAML SSO 集成

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 v6.1 must（大客户门槛）
> **工作量**：4 周
> **团队**：架构组 + SRE
> **前置依赖**：MetaPlatform-AUTH-01 ✅

---

## 1. 目标

实现 v6.0 平台的 SAML 2.0 SSO 集成（企业级 IdP 接入），让大客户能用公司内部 IdP（Azure AD / Okta / Auth0）登录 mp-platform。

## 2. 配套文档

- v6.1 路线图：[docs/active/v6.1-roadmap.md](../v6.1-roadmap.md) §must v6.1
- ADR-0066：[docs/active/decisions/ADR-0066-v6.1-saml-sso.md](../decisions/ADR-0066-v6.1-saml-sso.md)
- Auth PRD：[auth-jwt-rls.md](../prd/auth-jwt-rls.md) §6.1

## 3. 核心交付

| 项 | 验证 |
|---|---|
| Supabase Auth SAML provider 配置 | Studio 配置可见 |
| 每租户 IdP metadata 存储表 | `public.tenant_sso_configs` |
| SAML metadata XML 解析 Edge Function | `functions/saml-metadata` |
| SP-initiated SSO flow | `functions/saml-assertion` |
| Attribute mapping (email + role + tenant_id) | `tenant_sso_configs.claim_mappings` |
| 1 个 mock IdP for CI 测试 | `tests/saml/` |

## 4. 详细任务清单

### Week 1：Schema + 解析
- [x] `tenant_sso_configs` 表 (PRD §6.1)
- [x] `saml_assertions` 表 (SP 收到 assertion 缓存)
- [x] `saml-metadata` Edge Function (parse IdP XML)
- [x] XML 解析测试 (mock IdP)

### Week 2：SP-initiated SSO
- [x] `saml-assertion` Edge Function (validate + 映射)
- [x] sign 请求 + 接收 assertion
- [x] custom_access_token_hook 扩展 (从 SAML attribute 读 tenant_id)
- [x] session 创建

### Week 3：IdP 适配
- [x] Azure AD metadata 解析
- [x] Okta metadata 解析
- [x] Auth0 metadata 解析
- [x] claim mapping 通用化

### Week 4：E2E + Evidence
- [x] Mock IdP for CI (saml-idp-mock)
- [x] Playwright E2E (sso.spec.ts)
- [x] evidence/MetaPlatform.1-SAML-SSO-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [x] 3 个 IdP 适配（Azure AD / Okta / Auth0）
- [x] Per-tenant IdP config
- [x] Attribute mapping (email / role / tenant_id)
- [x] SP-initiated SSO 跑通
- [x] E2E 测试
- [x] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| IdP metadata 格式差异 | 通用 XML parser + 适配器模式 |
| Clock skew 导致 assertion 失败 | 5 分钟时钟容差 |
| Attribute 名差异（email vs mail vs user.email）| 通用 mapping 配置 |

---

*MetaPlatform.1-SAML-SSO-01 — v6.1 must 集成大客户*