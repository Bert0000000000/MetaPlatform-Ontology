# MetaPlatform-APPROVAL-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 SaaS app 申请 + 1周+ E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-APPROVAL-01.md](../batch/MetaPlatform-APPROVAL-01.md)
> **关联 PRD**：[approval-saas-adapters.md](../prd/approval-saas-adapters.md)
> **前置依赖**：MetaPlatform-HITL-HUB-01 ✅

---

## 验收标准（AC）

- [x] Common ApprovalAdapter 接口 (`packages/mp-approval-saas/src/types.ts`)
  - [x] createApproval + getApproval + verifyWebhook + parseWebhook
  - [x] ProviderRegistry (primary + fallback 自动切换)
- [x] 钉钉适配层 (`packages/mp-approval-saas/src/adapters/dingtalk.ts`)
  - [x] OAuth gettoken + createApproval (topapi/processinstance/create)
  - [x] getApproval (status 映射: NEW/RUNNING → pending; COMPLETED → approved/rejected; CANCELED → expired)
  - [x] webhook HMAC-SHA256 sign 验证
- [x] 飞书适配层 (`packages/mp-approval-saas/src/adapters/feishu.ts`)
  - [x] tenant_access_token + createApproval (approval/v4/instances)
  - [x] getApproval (status 映射: PENDING/APPROVED/REJECTED/CANCELED)
  - [x] webhook verification_token 验证
- [x] 企微适配层 (`packages/mp-approval-saas/src/adapters/wecom.ts`)
  - [x] corp access_token + createApproval (oa/smartwork/approval/create)
  - [x] getApproval (sp_status 1-4 映射)
  - [x] webhook msg_signature SHA1 验证
- [x] 多级超时升级链 (`supabase/migrations/20260820170000_create_tenant_approval_config_and_escalation.sql`)
  - [x] `tenant_approval_config` 表 (primary + fallback provider)
  - [x] `tenant_escalation_chain` 表 (4 级升级配置)
  - [x] `hitl_escalation_events` 审计表
  - [x] pg_cron `hitl-multi-level-escalation` 每 15 分钟检查
- [x] 单元测试 (`packages/mp-approval-saas/tests/adapters.test.ts`, 4 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] 申请 3 家 SaaS app (钉钉 /飞书 /企微) + 获取凭证
- [ ] 凭证通过 ExternalSecret 注入 (DINGTALK_APP_KEY_TENANT_X 等)
- [ ] 配置 `tenant_approval_config` (per-tenant: primary + fallback)
- [ ] 配置 `tenant_escalation_chain` (24h→B / 48h→C / 72h→D)
- [ ] 端到端测试:
  - [ ] 钉钉: 合同审批 → 钉钉同意 → Temporal signal → workflow 恢复
  - [ ] 飞书: 同样流程, 切换 primary=feishu
  - [ ] 企微: 同样流程, 切换 primary=wecom
  - [ ] fallback: 主 provider 限流 → 自动切 fallback
  - [ ] 多级升级: timeout 24h → 自动升级到 level 1
  - [ ] 1 周+ 长审批: 7 天 timeout E2E (资源消耗大)
- [ ] webhook + polling 双对账验证 (HITL-HUB-01 hitl-poll-reconcile)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `packages/mp-approval-saas/src/types.ts` | Common ApprovalAdapter 接口 + ProviderRegistry |
| `packages/mp-approval-saas/src/adapters/dingtalk.ts` | 钉钉适配层 (HMAC-SHA256 sign) |
| `packages/mp-approval-saas/src/adapters/feishu.ts` | 飞书适配层 (verification_token) |
| `packages/mp-approval-saas/src/adapters/wecom.ts` | 企微适配层 (msg_signature SHA1) |
| `packages/mp-approval-saas/{package.json, tsconfig.json}` | pnpm workspace 包 |
| `packages/mp-approval-saas/tests/adapters.test.ts` | 4 cases (主 / fallback / 双重失败 / 未注册) |
| `supabase/migrations/20260820170000_*.sql` | 3 表 + pg_cron + 升级审计 |
| `docs/active/prd/approval-saas-adapters.md` | PRD v1.0 (10 节) |
| `docs/active/batch/MetaPlatform-APPROVAL-01.md` | Batch doc |
| `evidence/MetaPlatform-APPROVAL-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| SaaS API 限流 | 3 家互备 + retry + backoff |
| webhook 丢失 | hitl-poll-reconcile cron 兜底 |
| 1 周测试资源消耗 | staging 演练 + 复用一次 7 天测试 |
| 多级升级不及时 | pg_cron 每 15 分钟检查 |

## 通知下游

✅ APPROVAL-01 骨架完成。下游可启动:
- **MetaPlatform-LONG-TASK-01** (4w) — 1 周+ 长任务 5 大机制完整化 (本 Batch 部分实现)

---

*APPROVAL-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 2 第三方审批就绪*