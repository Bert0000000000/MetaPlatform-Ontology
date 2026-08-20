# MP-V6-EDGE-FN-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 17 域部署 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-EDGE-FN-01.md](../batch/MP-V6-EDGE-FN-01.md)
> **关联 PRD**：[edge-fn-17-domains.md](../prd/edge-fn-17-domains.md)
> **前置依赖**：MP-V6-AUTH-01 ✅ + MP-V6-HITL-HUB-01 ✅ + MP-V6-TEMPORAL-01 ✅ + MP-V6-ONTOLOGY-GEN-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/edge-fn-17-domains.md, 10 节)
- [x] 标准 CRUD 走 PostgREST 自动（17 域表已在 FOUNDATION 创建, RLS 自动按 JWT.tenant_id 隔离）
- [x] Edge Functions 部署就绪 (8 个):
  - [x] `create-order` (MIGRATION 已有, 完整版)
  - [x] `apply-ontology-change` (ONTOLOGY-GEN-01 已有, 完整版)
  - [x] `_template-auth` (AUTH-01 已有)
  - [x] `hitl-webhook` (MIGRATION 已有)
  - [x] `dsp-webhook` (DB trigger 路由)
  - [x] `oauth-dingtalk-callback` (AUTH-01)
  - [x] `ticket-triage` (NEW — 客服工单自动分诊)
  - [x] `bulk-import` (NEW — 批量导入 admin only)
- [x] Temporal workflows (`packages/mp-temporal-worker-template/src/workflows/business.ts`)
  - [x] `orderApprovalWorkflow` (>10k 自动启动, 24h timeout)
  - [x] `contractApprovalWorkflow` (>100k 走 SaaS 1 周+, ≤100k 走 dsh 24h)
  - [x] `processInvoiceWorkflow` (发票 PDF + 邮件)
- [x] Ticket-triage heuristic 测试 (`tests/edge/ticket_triage.test.ts`, 3 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase functions deploy <fn>` 部署 8 个 Edge Functions
- [ ] 17 域 PostgREST schema 暴露（自动随 migration 应用）
- [ ] Temporal Worker 集成 business.ts workflows（worker.ts 注册 activities）
- [ ] 端到端测试:
  - [ ] customers: POST /rest/v1/customers → 自动 RLS 隔离
  - [ ] orders: create-order (>10k) → orderApprovalWorkflow 启动 → HITL SaaS
  - [ ] contracts: approve-contract (>100k) → workflow_saas (1 周审批)
  - [ ] tickets: ticket-triage → 高优 → HITL tool_dsh
  - [ ] bulk-import: 1000 行 customers → batch 500 × 2
- [ ] Idempotency 测试 (重复 POST 同 Idempotency-Key)
- [ ] 跨 tenant RLS 测试 (tenant A 不能读 tenant B 数据)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/edge-fn-17-domains.md` | PRD v1.0 (10 节) |
| `packages/mp-temporal-worker-template/src/workflows/business.ts` | order / contract / invoice approval workflows |
| `supabase/functions/ticket-triage/index.ts` | 工单自动分诊 (启发式 + HITL) |
| `supabase/functions/bulk-import/index.ts` | 批量导入 (admin only) |
| `tests/edge/ticket_triage.test.ts` | 3 cases 启发式测试 |
| `evidence/MP-V6-EDGE-FN-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Edge Function 150s timeout | 长任务 Temporal workflow |
| 多步事务 | supabase.rpc 调 PG function |
| 跨域 JOIN 慢 | 部分 denormalize + 索引 |
| 高频 ticket-triage 误判 | HITL 兜底 (urgent/high 必走) |

## 通知下游

✅ EDGE-FN-01 骨架完成。下游可启动:
- **MP-V6-RAG-01** (4w) — RAGFlow + GraphRAG 集成到 documents Edge Function
- **MP-V6-EVENTS-01** (2w) — Database Webhook 路由扩展

---

*EDGE-FN-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 2 业务迁移就绪*