# PRD：foundation-rls-policy

> **模块**：MetaPlatform v6.0 基础设施层 — RLS 行级安全策略
> **对应 Batch**：[MP-V6-FOUNDATION-01](../batch/MP-V6-FOUNDATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：架构组 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

定义 v6.0 **所有表必须遵守的 RLS（Row Level Security）策略标准**，确保多租户隔离、跨应用访问控制、CI gate 自动检测。本 PRD 不写具体业务的 RLS 逻辑（那是各应用 Batch 的事），**只定义**：

- RLS 启用强制规则
- Policy 模板（CRUD × 角色）
- `tenant_id` 注入约定
- CI gate `rls-check` 的检测规则
- 例外与豁免流程

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期"5 层隔离"架构复杂、漏洞多（曾经出现跨租户数据泄露 P0 事故）
- v6.0 决策 #6：**单一 Postgres RLS 层**取代 5 层隔离（见 [architecture spec §1 决策表](../specs/2026-08-19-mp-v6-architecture.md)）
- RLS 是 v6.0 安全模型的**唯一防线**，必须自动化保证（CLAUDE.md §8 强约束）

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | **100% 表**启用 RLS（无例外，CI 强制）|
| G2 | 跨租户查询**100% 被拒**（端到端测试覆盖）|
| G3 | Policy 模板化（CRUD × 4 角色），禁止随意写裸 policy |
| G4 | CI gate `rls-check` 在 PR 阶段强制，无 RLS 表**不准合并**|
| G5 | RLS 性能影响可控（< 5% overhead，benchmark 验证）|

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **应用 Owner** | 创建业务表时套用 RLS policy 模板；新增角色时扩展模板 |
| **DBA / SRE** | 用 Supabase Studio RLS Editor 审核 policy；故障排查跨租户访问 |
| **安全审计** | 周期性扫描所有 RLS policy 是否符合标准 |
| **CI 系统** | `rls-check` 扫描 `supabase/migrations/*.sql`，拒绝不合规 PR |

## 4. 功能需求（Functional Requirements）

### 4.1 RLS 启用强制规则

**规则 1：所有 `CREATE TABLE` 必须紧跟 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`**

```sql
-- ✅ 合规
CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    ...
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ❌ 不合规（缺 ENABLE）
CREATE TABLE public.orders (...);
```

**规则 2：所有 `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` 必须包含 `comment` 说明豁免原因**

```sql
-- 唯一豁免场景：service_role 内部使用的临时表 / 物化视图
ALTER TABLE public._internal_cache DISABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public._internal_cache IS 'RLS-exempt: service_role only, no anon/authenticated access. Tracked in foundation-rls-policy §4.6';
```

**规则 3：豁免表必须有 `_` 前缀命名（`_internal_*`、`_tmp_*`、`_cache_*`）**

便于审计识别。

### 4.2 Policy 模板（CRUD × 4 角色）

每个启用 RLS 的表**必须**有以下 4 类 policy（service_role 例外）：

#### 4.2.1 角色定义（约定）

| 角色 | 来源 | 默认权限 |
|---|---|---|
| `service_role` | Supabase 服务端 | **全权**（仅服务端）|
| `authenticated` | Supabase Auth 登录用户 | 受 RLS 限制 |
| `anon` | 未登录 | 仅 `auth.*` 相关 schema |
| `owner` / `admin` / `member` / `guest` | `profiles.role` | 由 `profiles.role` 派生 |

#### 4.2.2 Policy 模板：SELECT（authenticated）

```sql
CREATE POLICY "<table>_select_own_tenant" ON public.<table>
FOR SELECT TO authenticated
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

#### 4.2.3 Policy 模板：INSERT（authenticated）

```sql
CREATE POLICY "<table>_insert_own_tenant" ON public.<table>
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND created_by = auth.uid()
);
```

#### 4.2.4 Policy 模板：UPDATE（authenticated）

```sql
CREATE POLICY "<table>_update_own_tenant" ON public.<table>
FOR UPDATE TO authenticated
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND updated_by = auth.uid()
);
```

#### 4.2.5 Policy 模板：DELETE（authenticated，**默认禁用**）

```sql
-- v6.0 默认软删，禁止硬 DELETE
-- 例外：必须显式创建 DELETE policy 并写明业务原因
CREATE POLICY "<table>_delete_own_tenant" ON public.<table>
FOR DELETE TO authenticated
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() ->> 'role') IN ('owner', 'admin')  -- 显式角色限制
);
```

#### 4.2.6 service_role 全权 policy

```sql
CREATE POLICY "<table>_service_role_all" ON public.<table>
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
```

### 4.3 `tenant_id` 注入约定

**所有 INSERT 必须由触发器自动注入 `tenant_id`**（防止应用代码绕过）：

```sql
CREATE OR REPLACE FUNCTION public.tg_inject_tenant() RETURNS trigger AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
    END IF;
    IF NEW.tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id cannot be null';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_inject_tenant
BEFORE INSERT ON <schema>.<table>
FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
```

**CI 规则**：任何业务表**必须**挂 `tg_inject_tenant` 触发器。

### 4.4 CI gate `rls-check` 检测规则

详见 [`docs/active/workflows/ci.yml`](../workflows/ci.yml) 第 8 项 job。规则：

| 检测项 | 规则 | 失败动作 |
|---|---|---|
| 所有 `CREATE TABLE` 后必须 `ENABLE ROW LEVEL SECURITY` | regex 扫描 `supabase/migrations/*.sql` | exit 1 |
| `DISABLE ROW LEVEL SECURITY` 必须有 `COMMENT ON TABLE` 解释 | 同上 | exit 1 |
| `tenant_id` 字段必须存在 | 同上 | exit 1 |
| 必须有 4 类 policy（SELECT/INSERT/UPDATE/DELETE）或 service_role 全权 | 解析 CREATE POLICY | warning（不阻断）|
| DELETE policy 必须显式包含 role 限制 | 解析 USING 子句 | exit 1 |

**脚本位置**：`scripts/ci/rls-check.sh`（CI 容器内执行）。

### 4.5 性能要求

- RLS 启用后单表 SELECT 性能影响 < 5%（与未启用对比，p95 latency）
- benchmark 脚本：`bench/rls-overhead.sql`（在 staging 集群跑）
- 每个新业务表 PR 必须附 benchmark 结果

### 4.6 RLS 豁免流程

**只有以下场景可豁免**：

| 场景 | 命名约定 | 额外要求 |
|---|---|---|
| service_role 内部临时表 | `_tmp_*` | 仅 `service_role` 可访问；写入审计 |
| 物化视图 / 缓存 | `_cache_*` / `_mv_*` | 必须显式 `GRANT` 给指定角色 |
| pgvector 内部字典 | `_vector_dict_*` | — |

**豁免申请流程**：
1. PR 中说明豁免表用途
2. 架构组 + DBA 双签
3. `evidence/<batch>-RLS-EXEMPTIONS.md` 中记录

### 4.7 RLS policy 自检脚本

```sql
-- 应用 Owner 跑这个查自己表的 RLS 状态
SELECT
    schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY rowsecurity ASC, schemaname, tablename;
-- rowsecurity = f 的表必须出现在豁免清单
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **安全性** | 跨租户查询 100% 被拒（端到端 fuzz 测试）|
| **性能** | 单表 RLS overhead < 5%（p95）|
| **可维护性** | Policy 模板统一；新增表复制模板即可 |
| **可审计** | 所有豁免表在豁免清单中可查 |
| **可回滚** | 误加 policy 可用 `DROP POLICY <name>` 一行回滚 |

## 6. 接口契约

### 6.1 `auth.jwt()` payload 约定

Supabase Auth JWT 必须包含 `tenant_id` 与 `role` 两个 claim：

```json
{
  "sub": "<user_id>",
  "tenant_id": "<tenant_uuid>",
  "role": "member",
  "email": "user@example.com",
  ...
}
```

**注入时机**：登录成功后的 Edge Function（`mp-auth-svc`）写入 custom claim。

### 6.2 policy 测试 helper

```sql
-- pgTAP / Supabase Test helpers
SELECT tests.test_rls_select('<table>', '<test_user>', '<expected_rows>');
```

测试 helper 位置：`supabase/tests/rls/`

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 100% 表启用 RLS（除豁免清单）| `SELECT count(*) FROM pg_tables WHERE NOT rowsecurity` = 0 |
| AC2 | 跨租户查询 100% 被拒（端到端测试）| `tests/rls/cross_tenant_test.sql` |
| AC3 | RLS overhead < 5%（benchmark）| `bench/rls-overhead.sql` 在 staging 跑 |
| AC4 | CI gate `rls-check` 全绿 | GitHub Actions 历史 |
| AC5 | 豁免表 100% 在清单中 | `evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md` |
| AC6 | 所有 policy 模板化（无裸写）| 人工 review + grep |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Supabase 已部署 | foundation-supabase-schema | 必须先 |
| Supabase Auth + JWT 注入 `tenant_id` claim | mp-auth Batch（FOUNDATION 之后）| 关键路径 |
| pgTAP / Supabase 测试框架 | Supabase CLI | 启动前装 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| RLS policy 写错导致数据泄露 | P0 事故 | `rls-check` CI + 端到端测试 + Studio RLS Editor 审核 |
| RLS 性能开销过大 | 高频查询变慢 | benchmark 强制 + 必要时用 security-barrier 物化视图 |
| 业务 Owner 绕过（用 service_role）| 数据隔离失效 | CI 禁止 `service_role` 在 Edge Function 里被调用 |
| JWT claim 缺失 `tenant_id` | RLS 把所有人当成同一租户拒绝 | mp-auth Batch 必须先完成 |

## 10. 不做（Out of Scope）

- ❌ **行级加密（Transparent Data Encryption）**：v6.0 只做表级加密 + 字段级加密留给 v6.1
- ❌ **动态脱敏**：v6.0 不做（数据脱敏在 mp-monitoring/audit 层处理）
- ❌ **跨租户 JOIN 视图**：v6.0 禁止（防止误用导致泄露）
- ❌ **RLS policy 调优工具**：用 pg_stat_statements + 人工 review

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-networkpolicy](foundation-networkpolicy.md) / [foundation-dr-backup](foundation-dr-backup.md)*