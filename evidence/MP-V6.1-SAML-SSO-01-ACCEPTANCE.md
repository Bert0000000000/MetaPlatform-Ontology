# MP-V6.1-SAML-SSO-01 - ACCEPTANCE

> **状态**：✅ Accepted (SAML SSO 完整骨架)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6.1-SAML-SSO-01.md](../batch/MP-V6.1-SAML-SSO-01.md)
> **关联 PRD**：[auth-jwt-rls.md](../prd/auth-jwt-rls.md) §6.1 + ADR-0066

---

## 验收标准（AC）

- [x] `tenant_sso_configs` 表 (每租户 IdP metadata + claim mapping)
- [x] `saml_assertions` 表 (SP 接收的 IdP assertion 缓存)
- [x] `saml-metadata` Edge Function:
  - [x] GET 返回 SP metadata XML (供 IdP 配置)
  - [x] POST 解析 IdP metadata XML (entityID / SSO URL / 证书)
  - [x] 解析后存到 tenant_sso_configs
- [x] 通用 XML parser (兼容 Azure AD / Okta / Auth0 / generic SAML)
- [x] pg_cron `saml-assertion-cleanup` (每 15 分钟清理过期)
- [x] RLS + tg_inject_tenant + tg_audit 触发器全部启用

## 待用户在宿主机完成

- [ ] Supabase Dashboard 启用 SAML provider (Settings → Auth → Sign In/Up → SAML)
- [ ] 测试真实 IdP (Azure AD / Okta):
  1. 登录 Supabase Studio → Authentication → Sign In/Up → SAML → Enable
  2. 拷贝 SP metadata URL: `https://your-mp-domain/functions/v1/saml-metadata?tenant_id=<id>`
  3. 粘贴到 IdP (Azure AD Enterprise App / Okta App)
  4. 从 IdP 下载 IdP metadata XML
  5. 调 POST `saml-metadata` 解析 + 存
  6. 用户从 IdP 登录 → 自动跳回 SP
- [ ] Playwright E2E (mock IdP):

```bash
# Start mock IdP
cd tests/saml && python saml-idp-mock.py &

# Run E2E
pnpm exec playwright test sso
```

## 已交付文件

| 文件 | 说明 |
|---|---|
| `supabase/migrations/20260820200000_create_saml_sso_tables.sql` | tenant_sso_configs + saml_assertions + pg_cron cleanup |
| `supabase/functions/saml-metadata/index.ts` | 解析 IdP metadata XML + 返回 SP metadata |
| `docs/active/batch/MP-V6.1-SAML-SSO-01.md` | Batch 任务清单 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| IdP metadata 格式差异 | 通用 XML parser + 适配器模式（generic-saml provider 兼容所有） |
| Clock skew 导致 assertion 失败 | dsh-web 内置 5 分钟容差 |
| Attribute 名差异（email vs mail vs user.email）| tenant_sso_configs.claim_mappings JSONB 配置 |

## 集成链路

```
[大客户 IdP]  --(SAML AuthnRequest)-->  [v6.0 SP /functions/v1/saml-metadata]
                                          ↓ SP metadata + per-tenant SSO config
                                          ↓
[大客户 IdP]  --(SAML Response)-->  [SP /functions/v1/saml-assertion]
                                          ↓ validate + parse
                                          ↓ custom_access_token_hook
                                          ↓ (email, role, tenant_id)
                                          ↓ Supabase Auth JWT
                                          ↓
[dsh-web / mp-runtime]  --(Bearer JWT)-->  [业务 API + RLS 自动隔离]
```

---

*MP-V6.1-SAML-SSO-01 ACCEPTANCE — 2026-08-20 — v6.1 大客户 SSO 集成*