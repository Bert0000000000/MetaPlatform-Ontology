# MP-V6-DOMAIN-MIGRATE-01 — 17 域业务从 v3 → v6 迁移

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P3（业务核心）
> **工作量**：8 周
> **团队**：后端 + AI 团队
> **前置依赖**：MP-V6-EDGE-FN-01 ✅ + MP-V6-ONTOLOGY-GEN-01 ✅ + MP-V6-MIGRATION-01 ✅

---

## 1. 目标

按 6 类分批把 17 域业务从 v3.0（FastAPI Python）迁移到 v6.0（Supabase Edge Functions + PostgREST + Temporal workflow）。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-application-architecture.md` §3
- 模块规划 spec：`docs/active/specs/2026-08-19-mp-v6-module-planning.md` §3 (17 域清单)

## 3. 17 域分类

| P1 (5) | P2 (12) |
|---|---|
| Customer / Order / Product | Supplier / Inventory / Expense |
| Contract / Invoice | Project / Workflow / Approval |
| Ticket | Notification / Org / Knowledge |
| Employee / Department | Analytics |

## 4. 详细任务清单（按 6 类分批）

### Batch 1 (Week 1-2): P1 核心域
- [ ] Customer → customers Edge Function + 业务逻辑
- [ ] Order → create-order + orderApprovalWorkflow (EDGE-FN-01 部分实现, 完整化)
- [ ] Product → products PostgREST + 库存同步
- [ ] Contract → contracts Edge Function + HITL 审批
- [ ] Invoice → invoices Edge Function + processInvoiceWorkflow

### Batch 2 (Week 3-4): HR 域
- [ ] Employee → employees Edge Function + on/off-boarding workflow
- [ ] Department → departments Edge Function + 组织架构树
- [ ] Ticket → ticket-triage Edge Function + HITL (EDGE-FN-01 部分)

### Batch 3 (Week 5-6): 支撑域
- [ ] Supplier / Inventory / Expense
- [ ] Project / Workflow config
- [ ] Notification (Realtime + Email)

### Batch 4 (Week 7-8): 知识 + 分析
- [ ] Knowledge (articles + RAG 集成, RAG-01 已就绪)
- [ ] Analytics (metrics + dsh preset)
- [ ] Org (组织架构)

## 5. 验收标准（AC）

- [ ] 17 域 Edge Function 部署
- [ ] 标准 CRUD 走 PostgREST
- [ ] 复杂业务 走 Edge Functions + Temporal
- [ ] HITL Hub 集成（≥ 10 个触发点）
- [ ] E2E 测试通过
- [ ] 跨域 JOIN 验证
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨域数据不一致 | PG advisory lock + 事务包裹 |
| 业务逻辑回退 | 旧代码保留 6 个月 + feature flag |
| 性能回退 | 性能基准测试 + 灰度切流量 |

## 7. 下游依赖

本 Batch 完成后可启动：
- v6.0 GA 正式发布
- 切流量到 v6.0 (MIGRATION-01 §7.1)

---

*MP-V6-DOMAIN-MIGRATE-01 — Sprint 3 业务迁移*