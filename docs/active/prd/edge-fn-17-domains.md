# PRD：edge-fn-17-domains

> **模块**：17 域业务 Edge Functions (Deno + TypeScript)
> **对应 Batch**：[MP-V6-EDGE-FN-01](../batch/MP-V6-EDGE-FN-01.md)
> **状态**：Draft v1.0
> **负责人**：后端 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

将 17 域业务从 v3.0 FastAPI Python 后端迁移到 v6.0 Supabase Edge Functions（Deno + TypeScript）。标准 CRUD 走 PostgREST 自动，复杂业务逻辑用 Edge Functions 实现。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 FastAPI（Python），性能与并发受限
- v6.0 切到 Supabase Edge Functions（决策 #22，spec §1.1）
- PostgREST 自动 REST + Edge Functions 复杂业务（spec §7.8）

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 17 域 Edge Function 部署 |
| G2 | 标准 CRUD 走 PostgREST |
| G3 | 复杂业务 走 Edge Functions |
| G4 | Temporal workflow 集成（≥ 3 个） |
| G5 | HITL Hub 集成（≥ 5 个） |
| G6 | 完整 E2E + 跨 tenant RLS 测试 |

## 3. 17 域分类

| P1 | P2 |
|---|---|
| customers / orders / products | suppliers / inventory / expenses |
| contracts / invoices | projects / workflow_configs |
| tickets | hitl_requests / notifications |
| employees / departments | orgs / articles / metrics |
| documents | |

## 4. 功能需求

### 4.1 标准 CRUD（PostgREST 自动）

每个业务表 create 时，PostgREST 自动暴露 REST API：
- `GET /rest/v1/<table>` 列表
- `POST /rest/v1/<table>` 创建
- `PATCH /rest/v1/<table>?id=eq.xxx` 更新
- `DELETE /rest/v1/<table>?id=eq.xxx` 删除

RLS 自动按 JWT.tenant_id 过滤。

### 4.2 复杂业务 Edge Functions

| 函数 | 描述 | 触发 workflow/HITL |
|---|---|---|
| `create-order` | 创建订单 + amount>10k 自动启动 orderApprovalWorkflow | Temporal |
| `approve-contract` | 审批合同 | HITL action_confirm |
| `process-invoice` | 处理发票 (生成 + 发邮件 + webhook) | Temporal |
| `bulk-import` | 批量导入 (with audit.disable=on) | — |
| `ticket-triage` | 自动分诊 (priority / assignee) | dsh support-triage |
| `apply-ontology-change` | 本体变更 (preview / apply) | HITL action_conf |

### 4.3 Temporal Workflows

- **orderApprovalWorkflow** (金额 > 10k 触发)
- **contractApprovalWorkflow** (合同审批)
- **processInvoiceWorkflow** (发票处理)
- **applyOntologyChangeWorkflow** (本 Batch 已实现)
- **previewOntologyChangeWorkflow** (本 Batch 已实现)

### 4.4 HITL 集成（4 类型）

- `workflow_saas`: 合同审批 / 大额订单 (via 钉钉/飞书/企微)
- `workflow_dsh`: dsh Web 内联审批
- `tool_dsh`: dsh 敏感 tool
- `action_confirm`: AI 提案预览

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 响应 | PostgREST < 200ms, Edge Functions < 500ms |
| 冷启动 | Supabase Edge 调度优化 |
| 多租户 | RLS 100% (PostgREST + Edge Functions) |
| 审计 | 100% 进 audit_log (tg_audit trigger) |

## 6. 接口契约

### 6.1 Edge Function 标准签名

```typescript
// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

interface AuthContext { /* tenant_id, user_id, role */ }

async function verifyAuth(req: Request): Promise<AuthContext> { /* ... */ }

serve(async (req) => {
  try {
    const auth = await verifyAuth(req);
    // 业务逻辑
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    // 标准错误响应
  }
});
```

### 6.2 Idempotency

业务写入用 `Idempotency-Key` header + 表的 `idempotency_key` 字段：
- POST `Idempotency-Key: <uuid>` → 服务端存 `(tenant_id, idempotency_key, response_body)`
- 重复请求 → 返回 cached response

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 17 域 Edge Function 部署 | `supabase functions list` |
| AC2 | 标准 CRUD 走 PostgREST | `curl /rest/v1/<table>` |
| AC3 | 复杂业务 走 Edge Functions | E2E 测试 |
| AC4 | Temporal workflow 集成（≥ 3 个） | Temporal UI |
| AC5 | HITL Hub 集成（≥ 5 个触发点） | E2E 测试 |
| AC6 | Idempotency | 重复请求测试 |
| AC7 | RLS 跨 tenant 测试 | e2e |
| AC8 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase Auth | MP-V6-AUTH-01 ✅ |
| HITL Hub | MP-V6-HITL-HUB-01 ✅ |
| Temporal Worker | MP-V6-TEMPORAL-01 ✅ |
| 17 域业务表 | MP-V6-FOUNDATION-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| Edge Function 150s timeout | 长任务 Temporal workflow |
| 多步事务 | supabase.rpc 调 PG function |
| 跨域数据不一致 | PG advisory lock |

## 10. 不做

- ❌ 替代 v3.0 FastAPI（直接 rewrite, 不双写）
- ❌ 自建 REST 框架（用 PostgREST）
- ❌ GraphQL（v6.0 不用）

---

*PRD v1.0 — 配套 [MP-V6-EDGE-FN-01 Batch](../batch/MP-V6-EDGE-FN-01.md)*