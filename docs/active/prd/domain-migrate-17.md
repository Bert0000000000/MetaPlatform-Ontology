# PRD：domain-migrate-17

> **模块**：17 域业务从 v3 FastAPI 迁 v6 Edge Functions
> **对应 Batch**：[MP-V6-DOMAIN-MIGRATE-01](../batch/MP-V6-DOMAIN-MIGRATE-01.md)
> **状态**：Draft v1.0
> **负责人**：后端 + AI 团队
> **日期**：2026-08-20

---

## 1. 概述（What）

按 6 类分批把 17 域业务从 v3.0 FastAPI Python 后端迁移到 v6.0 Supabase Edge Functions (Deno + TypeScript) + PostgREST + Temporal workflow + HITL Hub。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 FastAPI（Python）实现 17 域业务
- v6.0 切到 Supabase Edge Functions（决策 #22，spec §1.1）
- 大部分 CRUD 走 PostgREST 自动；复杂业务用 Edge Functions

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 17 域 Edge Function 部署（已有 8 个, 补 9 个） |
| G2 | 标准 CRUD 走 PostgREST（17 域 RLS 自动） |
| G3 | 复杂业务 走 Edge Functions + Temporal workflow |
| G4 | HITL Hub 集成（≥ 10 个触发点） |
| G5 | E2E 测试 + 跨 tenant 隔离 |

## 3. 17 域分类

| P1 (5) | P2 (12) |
|---|---|
| customers | suppliers / inventory / expenses |
| orders | projects / workflow_configs / hitl_requests |
| products | notifications / orgs / articles |
| contracts | metrics |
| invoices | |
| employees / departments | |
| tickets | |

## 4. 功能需求

### 4.1 标准 CRUD（PostgREST 自动）

所有业务表已有 RLS + audit_log + tg_inid_tenant，PostgREST 自动暴露 REST API。

### 4.2 复杂业务 Edge Functions（新增）

| 函数 | 域 | 描述 |
|---|---|---|
| `create-customer` | customers | 创建 + dedup (email + tenant) |
| `approve-contract` | contracts | HITL 触发 (本 Batch 新) |
| `generate-invoice` | invoices | PDF + 邮件 + 状态更新 |
| `onboard-employee` | employees | on/off-boarding workflow |
| `restructure-department` | departments | 树形结构调整 |
| `send-notification` | notifications | 多通道 (Realtime + Email) |
| `compute-metrics` | metrics | 聚合统计 |

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 响应 | PostgREST < 200ms, Edge Functions < 500ms |
| 多租户 | RLS 100% (17 域) |
| 审计 | 100% 进 audit_log |

## 6. 接口契约

### 6.1 Edge Function 标准签名

```typescript
serve(async (req) => {
  try {
    const auth = await verifyAuth(req);
    // 业务逻辑
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
  }
});
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 17 域 Edge Function 部署 | `supabase functions list` |
| AC2 | 跨 tenant RLS 测试 | E2E |
| AC3 | HITL Hub 集成（≥ 10 触发点） | E2E |
| AC4 | E2E 测试通过 | 集成测试 |
| AC5 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| 17 域业务表 | MP-V6-FOUNDATION-01 ✅ |
| HITL Hub | MP-V6-HITL-HUB-01 ✅ |
| Temporal Worker | MP-V6-TEMPORAL-01 ✅ |
| Auth | MP-V6-AUTH-01 ✅ |
| Edge Function 模板 | MP-V6-EDGE-FN-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 跨域数据不一致 | PG advisory lock |
| 业务逻辑回退 | v3.0 保留 6 个月 + feature flag |
| 性能回退 | 性能基准测试 |

## 10. 不做

- ❌ v3.0 schema 兼容（直接 rewrite）
- ❌ 双写（v6.0 单一 truth）
- ❌ Python 业务代码（TypeScript only）

---

*PRD v1.0 — 配套 [MP-V6-DOMAIN-MIGRATE-01 Batch](../batch/MP-V6-DOMAIN-MIGRATE-01.md)*