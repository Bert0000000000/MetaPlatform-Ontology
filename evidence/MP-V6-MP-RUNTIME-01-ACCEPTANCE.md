# MP-V6-MP-RUNTIME-01 - mp-runtime 业务运行时 (ACCEPTED)

> **状态**: ✅ Accepted
> **日期**: 2026-08-20
> **关联 Batch**: [MP-V6-MP-RUNTIME-01.md](../active/batch/MP-V6-MP-RUNTIME-01.md)
> **关联 PRD**: [mp-runtime.md](../active/prd/mp-runtime.md)
> **关联 Issue**: #14 (mp-runtime full) — closed

---

## 验收标准 (AC)

### 1. DB schema ✅
- [x] `mp_runtime` schema 已创建 + RLS enabled
- [x] `mp_runtime.functions` 表 (id, name, version, handler, tenant_id, config)
- [x] `mp_runtime.sessions` 表 (id, tenant_id, user_id, function_name, input_payload, status, result, error_message, duration_ms, started_at, finished_at)
- [x] 4 RLS policies per table (SELECT/INSERT/UPDATE/DELETE)
- [x] tg_inject_tenant trigger (sessions only — functions 允许 NULL for global)
- [x] tg_audit trigger (sessions)
- [x] seed: 1 global function `mp-runtime-hello` v1.0.0
- [x] migration idempotent (CREATE TABLE IF NOT EXISTS + 动态 DROP policies)

### 2. Edge Functions ✅
- [x] `mp-runtime-trigger` (POST) — 校验 function 注册表 + 创建 session (status='queued')
- [x] `mp-runtime-status` (GET) — 读 session (manual RLS via tenant_id check)
- [x] `mp-runtime-cancel` (POST) — 取消 session (仅 queued/running → cancelled)
- [x] 所有 EF 使用 service_role + manual RLS (避免 JWT `role: 'member'` 触发 PG SET ROLE 失败)
- [x] 输入 validation: function_name regex, UUID check, priority enum

### 3. E2E 测试 ✅ (4/4 PASS)
- [x] test 1: trigger → status happy path (queued session retrievable, DB verify)
- [x] test 2: trigger unknown function → 404
- [x] test 3: cancel running session → status=cancelled, finished_at set, re-cancel → 409
- [x] test 4: cross-tenant RLS — tenantB 看不到 tenantA session, cancel 也 404

### 4. 基础设施 ✅
- [x] `supabase/config.toml` 添加 `mp_runtime` 到 `schemas` 和 `extra_search_path`
- [x] `NOTIFY pgrst 'reload config'` 应用生效
- [x] service_role 显式 GRANT (PostgREST 必需)
- [x] `playwright.config.ts` 添加 `mp-runtime.spec.ts` 到 supabase-api 项目

## 测试输出

```
Running 4 tests using 1 worker
  ok 1 — trigger -> status happy path (queued session retrievable) (321ms)
  ok 2 — trigger unknown function -> 404 (48ms)
  ok 3 — cancel running session -> status=cancelled, finished_at set (514ms)
  ok 4 — cross-tenant RLS: tenantB cannot read tenantA session via status (203ms)

  4 passed (2.8s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820400000_create_mp_runtime_tables.sql` | ~120 | idempotent migration |
| `supabase/functions/mp-runtime-trigger/index.ts` | ~100 | POST trigger |
| `supabase/functions/mp-runtime-status/index.ts` | ~85 | GET status |
| `supabase/functions/mp-runtime-cancel/index.ts` | ~115 | POST cancel |
| `e2e/mp-runtime.spec.ts` | ~210 | 4 tests + cross-tenant RLS |
| `supabase/config.toml` | +2 lines | mp_runtime schema 暴露 |
| `playwright.config.ts` | +1 line | 添加 mp-runtime |
| `docs/active/batch/MP-V6-MP-RUNTIME-01.md` | ~120 | batch 文档 |

## 已知 issue (后续 Batch)

- **#15** mp-knowledge GraphRAG — pending
- **#16** mp-sandbox 代码执行沙箱 — pending

## 完成时间表

| 阶段 | 状态 | 备注 |
|---|---|---|
| 1. PRD 阅读 + 方案设计 | ✅ | 3 Edge Functions + 2 tables |
| 2. Migration (idempotent) | ✅ | 含动态 DROP policies |
| 3. config.toml schema 暴露 | ✅ | schemas + extra_search_path |
| 4. 3 Edge Functions 实现 | ✅ | manual RLS via service_role |
| 5. 4 E2E 测试 | ✅ | 4/4 PASS |
| 6. Evidence + batch doc | ✅ | 本文件 + MP-V6-MP-RUNTIME-01.md |
| 7. Commit + push | ✅ | feat/mp-v6-mp-runtime-01 |

---

*MP-V6-MP-RUNTIME-01 ACCEPTED — 2026-08-20 — 0 bug, 3 Edge Functions, 4/4 E2E*