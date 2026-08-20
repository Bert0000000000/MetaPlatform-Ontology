# PRD：foundation-supabase-schema

> **模块**：MetaPlatform v6.0 基础设施层 — Supabase 公共 schema
> **对应 Batch**：[MetaPlatform-FOUNDATION-01](../batch/MetaPlatform-FOUNDATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + DBA
> **日期**：2026-08-20

---

## 1. 概述（What）

定义 v6.0 Supabase Postgres 的**公共 schema**（用户 / 租户 / 审计 三大基线表 + 必备扩展 + 迁移命名规范），所有后续 19 个应用的业务表都基于这套 schema 派生。

**本 Batch 不实现**：具体业务表（那是各应用 Batch 的事）。**本 Batch 落地**：所有应用**必须遵守**的底层 schema 与约定。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期各团队各自定义 `user_id` / `tenant_id` 字段 → 跨应用 JOIN 失败
- v6.0 必须**先**定义公共字段、命名、迁移规范，**再**允许业务表出现
- 单一 Postgres 实例（Supabase 内嵌 PG）承载所有应用 schema，通过 `search_path` + RLS 实现隔离

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 所有应用表**强制**包含 4 个公共字段：`id` / `tenant_id` / `created_at` / `updated_at` |
| G2 | 所有应用表**强制**关联到统一 `tenants` 表（多租户隔离）|
| G3 | 所有写操作**强制**走 `audit_log` 触发器（除批量导入外）|
| G4 | 迁移文件命名规范**强制**（CI gate `evidence-check` 不放行不规范的迁移）|
| G5 | `pgvector` 扩展**已安装且版本固定** |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **应用 Owner** | 创建新业务表时复用公共字段；新租户上线时往 `tenants` 插一行 |
| **DBA** | 用 Supabase Studio 审核 schema 变更、跑 RLS Editor 校验 |
| **SRE** | 跨应用 JOIN 故障排查（依赖 `tenant_id` 一致）|
| **审计 / 合规** | 查 `audit_log` 还原用户操作时间线 |

## 4. 功能需求（Functional Requirements）

### 4.1 必备扩展

```sql
-- 必须在 Supabase init 时启用
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";     -- uuid 生成
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- 加密
CREATE EXTENSION IF NOT EXISTS "vector";        -- pgvector（向量检索，固定版本 0.7+）
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- 模糊匹配
CREATE EXTENSION IF NOT EXISTS "btree_gin";     -- JSONB 索引支持
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";  -- 慢查询统计
```

### 4.2 公共 schema（`public` schema 下的基线表）

#### 4.2.1 `tenants` 表（租户）

```sql
CREATE TABLE public.tenants (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            text NOT NULL UNIQUE,          -- URL 友好的租户标识
    name            text NOT NULL,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'archived')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
-- 默认 policy：service_role 全权；anon / authenticated 仅看自己所属租户
```

#### 4.2.2 `profiles` 表（用户档案，1:1 绑定 Supabase Auth）

```sql
CREATE TABLE public.profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    email           text NOT NULL,
    display_name    text,
    role            text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
```

#### 4.2.3 `audit_log` 表（强制审计）

```sql
CREATE TABLE public.audit_log (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid REFERENCES public.tenants(id),
    actor_id        uuid REFERENCES auth.users(id),    -- 谁做的；system 操作为 NULL
    action          text NOT NULL,                     -- e.g. 'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT'
    schema_name     text NOT NULL,
    table_name      text NOT NULL,
    row_pk          jsonb,                              -- 主键 JSON 形式
    old_values      jsonb,
    new_values      jsonb,
    ip_addr         inet,
    user_agent      text,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON public.audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON public.audit_log (actor_id, occurred_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- policy：tenant 成员仅能查自己 tenant 的 audit_log
```

#### 4.2.4 公共字段约束（应用表必须遵守）

```sql
-- 业务表必须包含的 4 个字段
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
tenant_id   uuid NOT NULL REFERENCES public.tenants(id)
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()

-- 可选但强烈推荐
created_by  uuid REFERENCES auth.users(id)
updated_by  uuid REFERENCES auth.users(id)
deleted_at  timestamptz                    -- 软删；v6.0 默认软删
```

**CI 检测规则**：所有 CREATE TABLE 必须含这 4 个字段（详见 [foundation-rls-policy](foundation-rls-policy.md)）。

### 4.3 触发器模板（自动写 audit_log）

```sql
-- 通用 audit 触发器函数
CREATE OR REPLACE FUNCTION public.tg_audit() RETURNS trigger AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_tenant uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, old_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(OLD.id), to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
        v_tenant := NEW.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, new_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(NEW.id), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        v_tenant := NEW.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, old_values, new_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(NEW.id), to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

每个业务表创建后追加：
```sql
CREATE TRIGGER tg_audit
AFTER INSERT OR UPDATE OR DELETE ON <schema>.<table>
FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
```

### 4.4 迁移文件命名规范

**格式**（Supabase 官方约定 + v6.0 扩展）：
```
supabase/migrations/<YYYYMMDDHHMMSS>_<purpose>.sql
```

**示例**：
```
supabase/migrations/
├── 20260820120000_init_extensions.sql
├── 20260820120100_create_tenants.sql
├── 20260820120200_create_profiles.sql
├── 20260820120300_create_audit_log.sql
├── 20260820120400_create_tg_audit_function.sql
└── <业务 Batch 各自添加>
```

**规则**：
- 时间戳必须单调递增（CI 检查）
- 文件名 snake_case，全小写
- 一次提交只允许**一个** schema 变更（避免混合 DDL + DML）
- **强制**包含 `ENABLE ROW LEVEL SECURITY` 与公共字段（CI gate `rls-check`）

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **数据隔离** | RLS 全覆盖（无 service_role 直查业务表）|
| **审计完整性** | 所有 DML 进 `audit_log`；批量导入用 `SET LOCAL audit.disable = on` 临时关闭 |
| **查询性能** | `tenants.slug`、`profiles (tenant_id, email)` 必须有 UNIQUE 索引；其他字段由业务表按需建 |
| **schema 演进** | 所有 DDL 通过 `supabase/migrations/` 走 GitOps；禁止 psql / Studio 直改 |
| **备份** | `audit_log` 保留 2 年（合规要求）；超过 2 年归档到冷存储（详见 [foundation-dr-backup](foundation-dr-backup.md)）|

## 6. 接口契约

### 6.1 RLS 策略标准（详见 [foundation-rls-policy](foundation-rls-policy.md)）

- service_role：**全权**（service 内部用）
- authenticated：仅能访问 `profiles.tenant_id = auth.jwt() ->> 'tenant_id'` 的数据
- anon：完全禁止读业务表（仅 Auth 注册流程需要）

### 6.2 触发器开关

```sql
-- 批量导入时关闭 audit
SET LOCAL audit.disable = on;
-- 业务代码
SET LOCAL audit.disable = off;
```

### 6.3 Supabase CLI 工作流

```bash
supabase db diff              # 本地与远端 schema diff
supabase migration new <name>  # 创建新迁移文件
supabase db push              # 应用迁移（GitOps 模式）
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 5 个扩展全部启用且版本固定 | `\dx` 输出 |
| AC2 | `tenants` / `profiles` / `audit_log` 三张表已创建且含公共字段 | `psql \d` |
| AC3 | 三张表 `ENABLE ROW LEVEL SECURITY` | `psql \d+` + CI |
| AC4 | `tg_audit` 函数已创建；至少 3 张示例业务表挂载触发器 | CI 端到端测试 |
| AC5 | 迁移文件命名规范、时间戳单调递增 | CI `evidence-check` |
| AC6 | 端到端测试：创建租户 → 注册用户 → 写数据 → audit_log 出现记录 → 跨租户查询被拒 | e2e test script |
| AC7 | `pgvector` 版本 ≥ 0.7 | `\dx vector` |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Supabase Helm chart | FOUNDATION-01 第 2 周 | 必须先部署 |
| cert-manager | foundation-k8s-clusters | 必须先部署 |
| dsh → Supabase 网络互通 | foundation-networkpolicy | 必须先配 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 公共字段约束被业务表绕过 | RLS 失效 | CI `rls-check` 强制 |
| `audit_log` 暴涨 → PG 性能下降 | 慢查询 | 6 个月内分区（v6.1 优化）|
| Supabase Helm chart 升级破坏扩展 | 服务起不来 | pin 版本 + 升级前 dry-run |
| `tg_audit` 性能开销（每个写操作多一次 INSERT）| 高频写入表受影响 | 单独 audit 关闭开关 + 监控 |

## 10. 不做（Out of Scope）

- ❌ **多 region 复制**：单 region
- ❌ **行级加密**：v6.0 透明加密 + 字段级加密留给 v6.1
- ❌ **数据湖 / OLAP 出口**：v6.0 不出 mp-data 边界，ETL 在 MetaPlatform-MIGRATION-01 之后
- ❌ **第三方 schema（mp-ai / mp-knowledge 等）**：由各自 Batch 实现

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [foundation-rls-policy](foundation-rls-policy.md) / [foundation-networkpolicy](foundation-networkpolicy.md) / [foundation-dr-backup](foundation-dr-backup.md)*