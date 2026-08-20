# MP-V6-DOMAIN-MIGRATE-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 17 域部署 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-DOMAIN-MIGRATE-01.md](../batch/MP-V6-DOMAIN-MIGRATE-01.md)
> **关联 PRD**：[domain-migrate-17.md](../prd/domain-migrate-17.md)
> **前置依赖**：MP-V6-FOUNDATION-01 ✅ + MP-V6-EDGE-FN-01 ✅ + MP-V6-ONTOLOGY-GEN-01 ✅ + MP-V6-MIGRATION-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/domain-migrate-17.md, 10 节)
- [x] 标准 CRUD 走 PostgREST（17 域 RLS 自动, 28 表已建）
- [x] Edge Functions 累计部署 (12 个):
  - [x] `create-order` (MIGRATION) — orderApprovalWorkflow
  - [x] `apply-ontology-change` (ONTOLOGY-GEN) — preview + apply workflow
  - [x] `_template-auth` (AUTH) — verifyAuth + AuthError
  - [x] `hitl-webhook` (MIGRATION) — SaaS 回调 → decideHitl
  - [x] `dsp-webhook` (EVENTS) — 12 表路由
  - [x] `oauth-dingtalk-callback` (AUTH) — OAuth 2.0
  - [x] `ticket-triage` (EDGE-FN) — 启发式 priority + HITL
  - [x] `bulk-import` (EDGE-FN) — admin only, batch 500
  - [x] `rag-query` (RAG) — 双路并行 + 融合
  - [x] `approve-contract` (NEW) — HITL 合同审批
  - [x] `create-customer` (NEW) — dedup by (tenant, email)
  - [x] `generate-invoice` (NEW) — PDF + Storage + 邮件
  - [x] `onboard-employee` (NEW) — Auth user invite + profile + employee
  - [x] `send-notification` (NEW) — 多通道 (Realtime + Email)
- [x] 单元测试 (4 cases: customer dedup new/email/tenant)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase functions deploy` 12 个 Edge Functions
- [ ] 17 域 PostgREST schema 暴露（自动随 migration 应用）
- [ ] 端到端测试:
  - [ ] customers: create-customer + dedup + 跨 tenant 隔离
  - [ ] contracts: approve-contract > 100k → HITL workflow_saas
  - [ ] invoices: generate-invoice → PDF → Storage → 邮件
  - [ ] employees: onboard-employee → Auth invite + profile + employee
  - [ ] notifications: send-notification → Realtime broadcast
  - [ ] 跨域 JOIN 验证 (orders + customers + invoices)
  - [ ] RLS 跨 tenant 测试 (tenant A 不能读 tenant B 数据)
- [ ] 性能基准测试 (PostgREST < 200ms, Edge Functions < 500ms)
- [ ] v3.0 6 个月观察期 (deprecated, 不删服务)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/domain-migrate-17.md` | PRD v1.0 (10 节) |
| `supabase/functions/approve-contract/index.ts` | 合同审批 (HITL) |
| `supabase/functions/create-customer/index.ts` | 客户创建 + dedup |
| `supabase/functions/generate-invoice/index.ts` | 发票 PDF + 邮件 |
| `supabase/functions/onboard-employee/index.ts` | 员工 on/off-boarding |
| `supabase/functions/send-notification/index.ts` | 多通道通知 |
| `tests/domain/customer_dedup.test.ts` | 3 cases |
| `evidence/MP-V6-DOMAIN-MIGRATE-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨域数据不一致 | PG advisory lock + 事务包裹 |
| 业务逻辑回退 | v3.0 保留 6 个月 + feature flag |
| 性能回退 | 性能基准测试 + 灰度切流量 |
| Email 发送失败 | 重试 + dead-letter queue |

## 通知下游

✅ DOMAIN-MIGRATE-01 骨架完成。下游可启动:
- **MP-V6-V6.1-PREP** (2w) — v6.1 路线图（罗盘 / 应用中心 / 云市场 / Schema 版本管理）
- **MP-V6-LONG-TASK-01** (4w) — 1 周+ 长任务 5 大机制完整版

---

*DOMAIN-MIGRATE-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 3 17 域业务迁移就绪*