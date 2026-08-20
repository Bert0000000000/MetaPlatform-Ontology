# tests/

> 测试套件目录。所有 Batch 启动时必须包含对应测试。

## 目录

| 子目录 | 类型 | 工具 | 何时跑 |
|---|---|---|---|
| `db/` | pgTAP 数据库测试 | `pg_prove` / Supabase CLI | PR 阶段 + CI |
| `e2e/` | 端到端测试 | Playwright | PR 阶段 + 部署前 |
| `unit/` | 单元测试 | Vitest | 每次 commit + CI |

## 已有的测试

| 文件 | 配套 PRD | 说明 |
|---|---|---|
| [db/foundation-rls-test.sql](./db/foundation-rls-test.sql) | [foundation-rls-policy](../docs/active/prd/foundation-rls-policy.md) | 40 个 pgTAP 测试，覆盖 RLS 启用 / 跨租户隔离 / audit_log / 必备扩展 |
| [db/etl-validation-test.sql](./db/etl-validation-test.sql) | [etl-validation](../docs/active/prd/etl-validation.md) | 20 个 pgTAP 测试，覆盖 v3 → v6 ETL 行数 + RLS + 密码迁移 |

| 文件 | 配套 PRD | 说明 |
|---|---|---|
| [e2e/business-flows.spec.ts](./e2e/business-flows.spec.ts) | [etl-validation](../docs/active/prd/etl-validation.md) | Playwright 端到端测试：登录 / 跨租户 / 数字员工 / workflow |

## 跑测试

```bash
# pgTAP（DB 测试）
pg_prove -h $SUPABASE_DB_HOST -U supabase_admin -d postgres tests/db/*.sql

# Playwright（E2E）
pnpm playwright test tests/e2e/

# Vitest（单元）
pnpm test tests/unit/
```

## 编写规范

- 每个新模块 PRD 必须包含对应测试
- 测试代码进 GitOps（同应用代码一起 review）
- 测试覆盖率 ≥ 80%（关键模块 ≥ 90%）
- E2E 测试必须真实（不 mock Supabase）