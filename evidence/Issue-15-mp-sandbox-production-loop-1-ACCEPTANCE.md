# Issue #15 — mp-sandbox 生产路径 Loop 1/3 (ACCEPTED)

> **状态**：✅ Loop 1/3 Accepted
> **日期**：2026-08-20
> **关联 Issue**：#15 (mp-sandbox 完整生产路径)
> **Commit**：b834e83

---

## 验收标准 (Loop 1/3 — PoC → 生产切换 第 1 步)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `mp_sandbox.executions` 表创建 (id, tenant_id, actor_id, action, language, code_sha256, code_bytes, timeout_ms, network, exit_code, duration_ms, stdout_bytes, stderr_bytes, mode, metadata, created_at) | ✅ |
| AC1.2 | RLS policies (4 个: SELECT/INSERT/UPDATE/DELETE 走 `_policy_tenant_*` helpers) | ✅ |
| AC1.3 | tg_inject_tenant 触发器 (auto-fill tenant_id from JWT) | ✅ |
| AC1.4 | tg_audit 触发器 (auto-write to public.audit_log) | ✅ |
| AC1.5 | `mp_sandbox.execution_stats` view (per-tenant hourly stats) | ✅ |
| AC1.6 | mp-sandbox EF 双写: `mp_sandbox.executions` + `public.record_execution` RPC (Loop 2/3 删 RPC) | ✅ |
| AC1.7 | 5/5 E2E PASS (admin / denied / timeout / anon / executions+view+RLS+triggers) | ✅ |

## E2E 结果

```
Running 5 tests using 1 worker
[1/5] admin POST execute (echo hello) -> 200 + poc_mock          (pass)
[2/5] denied dangerous command (rm -rf /) -> 403                (pass)
[3/5] timeout exceeded -> 408                                    (pass)
[4/5] anon POST (no Authorization header) -> 401                 (pass)
[5/5] mp_sandbox.executions table + execution_stats view         (pass)

  5 passed (2.2s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820600000_create_mp_sandbox_executions.sql` | 90 | executions 表 + 4 RLS + 2 triggers + execution_stats view |
| `supabase/functions/mp-sandbox/index.ts` | 350 | recordExecution() helper + sha256Hex() helper + 3 audit sites refactor |
| `e2e/mp-sandbox.spec.ts` | 240 | 新增 test 5 (table + view + RLS + triggers 检查) |

## 部署要求

新 migration 在每次 supabase restart 后自动应用 (本地 dev OK). 生产部署需在 CI 的 `pnpm db:push` 流程中包含新 migration.

## 下一步 (Loop 2/3)

- 删 `public.record_execution` wrapper + `mp_sandbox.record_execution` RPC
- EF 只写 `mp_sandbox.executions` 表 (audit_log 由 tg_audit 触发器自动写)
- E2E 更新: 验证不再调用 RPC, 只验证 executions 表行数 == audit_log 行数

## 下下一步 (Loop 3/3)

- mp-runtime Deployment 加 sidecar (bwrap / Landlock)
- EF 切到 sidecar HTTP (`POST /execute`)
- 异步路径: K8s Job template + Temporal activity

---

*Issue #15 Loop 1/3 — 2026-08-20 — 5/5 E2E PASS, 0 bug*