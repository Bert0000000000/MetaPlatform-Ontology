# MetaPlatform-EDGE-FN-01 — 17 域业务迁移到 Edge Functions

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P2（17 域业务核心）
> **工作量**：6 周
> **团队**：后端 + SRE
> **前置依赖**：MetaPlatform-AUTH-01 ✅ + MetaPlatform-ONTOLOGY-GEN-01 ✅

---

## 1. 目标

将 17 域业务从 v3.0 FastAPI Python 后端迁移到 v6.0 Supabase Edge Functions (Deno + TypeScript)，按 ontology 设计重构业务逻辑。

## 2. 配套文档

- 技术架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §7.15
- PRD（待补）：`docs/active/prd/edge-fn-17-domains.md`

## 3. 核心交付

| 项 | 验证 |
|---|---|
| 17 域 Edge Function 部署 | `supabase functions list` |
| 标准 CRUD 用 PostgREST 自动 | `curl https://<project>.supabase.co/rest/v1/<table>` |
| 复杂业务用 Edge Functions | E2E 测试 |
| Temporal workflow 集成（apply-ontology-change / order-approval） | Temporal UI |
| HITL Hub 集成（4 种类型） | E2E 测试 |

## 4. 详细任务清单

### Week 1-2：P1 域 (5 个)
- [ ] customers Edge Function (CRUD)
- [ ] orders Edge Function (CRUD + 订单审批 workflow)
- [ ] products Edge Function (CRUD)
- [ ] contracts Edge Function (CRUD + HITL 审批)
- [ ] invoices Edge Function (CRUD)

### Week 3-4：P2 域 (12 个)
- [ ] suppliers / inventory / expenses / projects
- [ ] workflow_configs / hitl_requests / notifications
- [ ] orgs / articles / metrics
- [ ] employees / departments / tickets

### Week 5：复杂业务逻辑迁移
- [ ] orderApprovalWorkflow (Temporal)
- [ ] contractApprovalWorkflow (HITL 4 类型)
- [ ] apply-ontology-change (HITL action_confirm)
- [ ] bulk-import Edge Function (with audit.disable=on)

### Week 6：E2E + evidence
- [ ] 17 域 E2E 测试
- [ ] 跨域 JOIN 验证
- [ ] RLS 跨 tenant 测试
- [ ] evidence/MetaPlatform-EDGE-FN-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 17 域 Edge Function 部署
- [ ] 标准 CRUD 走 PostgREST
- [ ] 复杂业务 走 Edge Functions
- [ ] Temporal workflow 集成（≥ 3 个 workflow）
- [ ] HITL Hub 集成（≥ 5 个 HITL 触发点）
- [ ] E2E 测试通过
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Edge Function 冷启动 | Supabase Edge 调度优化 + keep-alive |
| 150s timeout 限制 | 长任务用 Temporal workflow |
| 多步事务 | Edge Function 内 supabase.rpc 调 PG function |

## 7. 下游依赖

本 Batch 完成后可启动：
- 17 域业务 Batch（按 Sprint 3 计划）

---

*MetaPlatform-EDGE-FN-01 — Sprint 2 业务迁移就绪*