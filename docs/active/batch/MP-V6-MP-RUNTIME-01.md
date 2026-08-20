# MP-V6-MP-RUNTIME-01 — mp-runtime 业务运行时 (Edge Functions)

> **Batch 状态**：✅ Accepted
> **优先级**：🟢 v6.0 must (19 应用之一)
> **工作量**：1d (3 Edge Functions + DB schema + E2E)
> **团队**：AI 团队 + SRE
> **前置依赖**：MP-V6-FOUNDATION-01 ✅ (Supabase + RLS + Edge Functions)

---

## 1. 目标

为 v6.0 19 个应用补齐缺失的 **mp-runtime 业务运行时**：3 个核心 Edge Functions (`mp-runtime-trigger` / `mp-runtime-status` / `mp-runtime-cancel`) + DB schema + RLS + E2E 验证。

> mp-runtime 是 19 应用中第 3 个落地（mp-runtime / mp-knowledge / mp-sandbox）— 本 Batch 只完成 mp-runtime，其余 2 个后续 iteration。

## 2. 配套文档

- **PRD**：[mp-runtime PRD](../prd/mp-runtime.md)
- **架构 spec**：[mp-v6-architecture §7](../specs/2026-08-19-mp-v6-architecture.md)

## 3. 核心交付

| 项 | 验证 |
|---|---|
| `mp_runtime` schema (PostgREST 暴露) | config.toml `schemas = [..., "mp_runtime"]` |
| `mp_runtime.functions` 表 (Edge Function 注册表) | DDL + 4 RLS policies |
| `mp_runtime.sessions` 表 (session lifecycle) | DDL + 4 RLS policies + inject_tenant + audit triggers |
| Edge Function `mp-runtime-trigger` (POST) | E2E |
| Edge Function `mp-runtime-status` (GET) | E2E |
| Edge Function `mp-runtime-cancel` (POST) | E2E |
| 4 个 Playwright E2E 测试 | 4/4 PASS |
| Seed function (`mp-runtime-hello`) | idempotent ON CONFLICT |

## 4. 关键决策

| 决策 | 内容 | 原因 |
|---|---|---|
| **manual RLS** | EF 用 service_role + 手动 `tenant_id == auth.tenantId` 检查 | JWT hook 把 `role` claim 设为 'member'，PostgREST SET LOCAL ROLE 'member' 失败 |
| **status / cancel EF** | service_role client (vs anon+JWT) | 避免 PG role 不存在的错误；tenant 隔离由 EF 显式保证 |
| **trigger EF** | service_role client | 同上，function registry 必须 service_role 读 |
| **functions 表支持 global (tenant_id NULL)** | 不挂 tg_inject_tenant trigger | seed 全局函数 tenant_id IS NULL，trigger 会失败 |
| **migration 必须 idempotent** | `CREATE TABLE IF NOT EXISTS` + 动态 SQL drop policies | supabase restart 后 migration 会重跑 |

## 5. 数据模型

```sql
-- 业务 Edge Function 注册表 (per PRD §4)
CREATE TABLE mp_runtime.functions (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         text NOT NULL UNIQUE,        -- 'mp-orders/create-order'
    version      text NOT NULL,
    handler      text NOT NULL,
    tenant_id    uuid REFERENCES public.tenants(id),  -- NULL = 全局
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 运行时 session lifecycle
CREATE TABLE mp_runtime.sessions (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    user_id         uuid NOT NULL REFERENCES auth.users(id),
    function_name   text NOT NULL,
    input_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    result          jsonb,
    error_message   text,
    duration_ms     int,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
```

## 6. 验证标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 部署 hello world Edge Function 全流程跑通 | E2E test 1 |
| AC2 | 多租户 ctx 自动注入（不传 tenant_id 也生效） | trigger EF 用 service_role + auth.tenantId |
| AC3 | 跨租户调用被 RLS 拒 | E2E test 4 |
| AC4 | OTel trace 含 tenant.id / function.name | (后续 Batch 加 OTel SDK) |
| AC5 | 冷启动延迟 < 200ms (p99) | (PaaS 调度保证，暂未测试) |
| AC6 | 函数级限流 (默认 100 QPS / 函数) | (Kong gateway 配置) |

## 7. 测试结果

```
Running 4 tests using 1 worker
  ok 1 — trigger -> status happy path (queued session retrievable) (321ms)
  ok 2 — trigger unknown function -> 404 (48ms)
  ok 3 — cancel running session -> status=cancelled, finished_at set (514ms)
  ok 4 — cross-tenant RLS: tenantB cannot read tenantA session via status (203ms)

  4 passed (2.8s)
```

## 8. 已交付文件

| 路径 | 说明 |
|---|---|
| `supabase/migrations/20260820400000_create_mp_runtime_tables.sql` | mp_runtime schema + 2 tables + RLS + triggers + seed + grants (idempotent) |
| `supabase/config.toml` | 添加 `mp_runtime` 到 `schemas` 和 `extra_search_path` |
| `supabase/functions/mp-runtime-trigger/index.ts` | POST: 创建 session (校验 function registry) |
| `supabase/functions/mp-runtime-status/index.ts` | GET: 读取 session (manual RLS) |
| `supabase/functions/mp-runtime-cancel/index.ts` | POST: 取消 session (manual RLS, 仅 queued/running) |
| `e2e/mp-runtime.spec.ts` | 4 E2E tests (含 cross-tenant RLS) |
| `playwright.config.ts` | 添加 `mp-runtime` 到 supabase-api 项目 |
| `evidence/MP-V6-MP-RUNTIME-01-ACCEPTANCE.md` | 验收证据 |
| `docs/active/batch/MP-V6-MP-RUNTIME-01.md` | 本文件 |

## 9. 已知边界 / 待办 (下个 iteration)

| 项 | 说明 |
|---|---|
| AC4 OTel trace | 待 MP-V6-OBSERVABILITY-01 Batch |
| AC5 冷启动 p99 | 待 K8s 部署后实测 |
| AC6 函数级限流 | 待 Kong gateway 配置 |
| mp-knowledge Edge Functions | Issue #15 |
| mp-sandbox Edge Functions | Issue #16 |

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| JWT `role` claim = 'member' 触发 PG SET ROLE 失败 | EF 全部用 service_role + manual RLS check |
| schema 必须显式加 PostgREST 暴露列表 | config.toml 修改 + NOTIFY pgrst 'reload config' |
| migration 重跑导致 CREATE POLICY 失败 | DO block 动态 drop + CREATE TABLE IF NOT EXISTS |
| audit_log FK 阻止 tenants 删除 | test cleanup 先删 audit_log |

---

*MP-V6-MP-RUNTIME-01 Accepted — 2026-08-20 — 3 Edge Functions shipped, 4/4 E2E pass*