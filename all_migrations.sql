DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS mp_preset_registry CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === 20260820120000_init_extensions.sql ===
-- supabase/migrations/20260820120000_init_extensions.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.1
-- Per CLAUDE.md §8 (强约束): 所有 v6.0 Supabase 实例必须启用以下 6 个扩展。
-- pgvector 版本由 Supabase Helm chart pin 0.7+ (AC7)。

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "vector"        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm"       WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gin"     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;

-- 业务代码应通过 search_path 访问 extensions.* 而非 public.*
-- Supabase 默认 search_path 已包含 extensions, 这里显式确认。
COMMENT ON SCHEMA extensions IS 'Shared Postgres extensions. search_path 优先于 public.';

-- === 20260820120100_create_tenants.sql ===
-- supabase/migrations/20260820120100_create_tenants.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.1
-- 公共字段: id / tenant_id / created_at / updated_at (应用表必须遵守)

CREATE TABLE public.tenants (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug         text NOT NULL UNIQUE,
    name         text NOT NULL,
    status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended', 'archived')),
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz
);

CREATE INDEX tenants_status_idx ON public.tenants (status) WHERE status <> 'archived';

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- service_role 全权; anon / authenticated 见自己所属租户
COMMENT ON TABLE public.tenants IS 'v6.0 multi-tenant registry. RLS: service_role full; authenticated sees only own tenant_id.';

CREATE POLICY tenant_self_select ON public.tenants
    FOR SELECT TO authenticated
    USING (id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY tenant_self_update ON public.tenants
    FOR UPDATE TO authenticated
    USING (id = (auth.jwt() ->> 'tenant_id')::uuid)
    WITH CHECK (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- INSERT/DELETE 限定 service_role (在 service policy 中另设)

-- === 20260820120200_create_profiles.sql ===
-- supabase/migrations/20260820120200_create_profiles.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.2
-- profiles 1:1 绑定 Supabase Auth (auth.users.id); 含公共字段

CREATE TABLE public.profiles (
    id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id     uuid NOT NULL REFERENCES public.tenants(id),
    email         text NOT NULL,
    display_name  text,
    role          text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX profiles_tenant_idx ON public.profiles (tenant_id);
CREATE INDEX profiles_role_idx  ON public.profiles (tenant_id, role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.profiles IS 'User profile 1:1 with auth.users. RLS: tenant isolation by JWT.tenant_id.';

-- 标准 4 policy (SELECT/INSERT/UPDATE/DELETE) — 见 supabase/policies/templates.sql
CREATE POLICY profile_tenant_select ON public.profiles
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_insert ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_delete ON public.profiles
    FOR DELETE TO authenticated
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (auth.jwt() ->> 'role') IN ('owner', 'admin')
    );

-- === 20260820120300_create_audit_log.sql ===
-- supabase/migrations/20260820120300_create_audit_log.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.3
-- 审计日志: 保留 2 年 (合规要求); 超过归档到冷存储 (见 foundation-dr-backup.md)

CREATE TABLE public.audit_log (
    id           bigserial,
    tenant_id    uuid REFERENCES public.tenants(id),
    actor_id     uuid REFERENCES auth.users(id),  -- system 操作为 NULL
    action       text NOT NULL,                    -- INSERT / UPDATE / DELETE / LOGIN / EXPORT
    schema_name  text NOT NULL,
    table_name   text NOT NULL,
    row_pk       jsonb,
    old_values   jsonb,
    new_values   jsonb,
    ip_addr      inet,
    user_agent   text,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 当月分区
CREATE TABLE public.audit_log_default PARTITION OF public.audit_log DEFAULT;

CREATE INDEX audit_log_tenant_idx ON public.audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx  ON public.audit_log (actor_id, occurred_at DESC);
CREATE INDEX audit_log_table_idx  ON public.audit_log (schema_name, table_name, occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audit_log IS 'Mandatory audit log. RLS: tenant isolation. 保留 2 年, 超期归档冷存储 (foundation-dr-backup.md).';

CREATE POLICY audit_log_tenant_select ON public.audit_log
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- INSERT/UPDATE/DELETE: 仅 service_role (触发器内部写入用 SECURITY DEFINER 函数)

-- === 20260820120400_create_tg_audit_function.sql ===
-- supabase/migrations/20260820120400_create_tg_audit_function.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.3
-- 通用 audit 触发器函数; 每个业务表挂载此触发器自动写 audit_log

CREATE OR REPLACE FUNCTION public.tg_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor  uuid := auth.uid();
    v_tenant uuid;
BEGIN
    -- 批量导入时通过 SET LOCAL audit.disable = on 跳过
    DECLARE
        v_audit_disabled text;
    BEGIN
        v_audit_disabled := current_setting('audit.disable', true);
    EXCEPTION WHEN OTHERS THEN
        v_audit_disabled := '';
    END;
    IF v_audit_disabled = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

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
$$;

COMMENT ON FUNCTION public.tg_audit() IS
    '通用 audit 触发器. 业务表通过 CREATE TRIGGER tg_audit AFTER INSERT/UPDATE/DELETE ... FOR EACH ROW EXECUTE FUNCTION public.tg_audit(); 挂载. SET LOCAL audit.disable = on 可临时关闭 (用于批量导入).';

-- === 20260820120500_rls_baseline_policies.sql ===
-- supabase/migrations/20260820120500_rls_baseline_policies.sql
-- PRD: docs/active/prd/foundation-rls-policy.md
-- 基础 RLS policy 模板; 业务表直接复用

-- service_role 全权策略（每个表都加） — 由 service_role bypass RLS 的特性,
-- 这里显式记录 service_role 可访问, 便于审计. 实际 RLS bypass 在 Supabase
-- Postgres role 层就生效 (service_role = BYPASSRLS).

-- 模板：tenant 隔离 SELECT
CREATE OR REPLACE FUNCTION public._policy_tenant_select(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_select', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 INSERT (要求 JWT.tenant_id == NEW.tenant_id)
CREATE OR REPLACE FUNCTION public._policy_tenant_insert(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_insert', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 UPDATE
CREATE OR REPLACE FUNCTION public._policy_tenant_update(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_update', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid) WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 DELETE (仅 owner / admin)
CREATE OR REPLACE FUNCTION public._policy_tenant_delete(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_delete', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR DELETE TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid AND (auth.jwt() ->> ''role'') IN (''owner'', ''admin''))',
        policy_name, p_table
    );
END;
$$;

COMMENT ON FUNCTION public._policy_tenant_select(regclass) IS 'RLS 模板: tenant 隔离 SELECT. 业务表调用: SELECT public._policy_tenant_select(''orders''::regclass);';
COMMENT ON FUNCTION public._policy_tenant_insert(regclass) IS 'RLS 模板: tenant 隔离 INSERT. WITH CHECK 强制 JWT.tenant_id == NEW.tenant_id.';
COMMENT ON FUNCTION public._policy_tenant_update(regclass) IS 'RLS 模板: tenant 隔离 UPDATE.';
COMMENT ON FUNCTION public._policy_tenant_delete(regclass) IS 'RLS 模板: tenant 隔离 DELETE (仅 owner / admin).';

-- === 20260820120600_tg_inject_tenant.sql ===
-- supabase/migrations/20260820120600_tg_inject_tenant.sql
-- PRD: docs/active/prd/foundation-rls-policy.md §4.3
-- 自动注入 tenant_id: 业务 INSERT 即使忘记填 tenant_id, 触发器从 JWT 注入.
-- 与 RLS policy 配合: WITH CHECK 保证 JWT.tenant_id == row.tenant_id.

CREATE OR REPLACE FUNCTION public.tg_inject_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
BEGIN
    IF jwt_tenant IS NULL THEN
        RAISE EXCEPTION 'tg_inject_tenant: JWT missing tenant_id claim'
            USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;

    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := jwt_tenant;
    ELSIF NEW.tenant_id <> jwt_tenant THEN
        RAISE EXCEPTION 'tg_inject_tenant: row.tenant_id (%) != JWT.tenant_id (%)',
            NEW.tenant_id, jwt_tenant
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_inject_tenant() IS
    '业务表 INSERT 前自动注入 tenant_id (从 JWT). 与 RLS WITH CHECK 双重保证多租户隔离. 业务表挂载: CREATE TRIGGER tg_inject BEFORE INSERT ON <table> FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();';

-- === 20260820120700_create_temporal_schema.sql ===
-- supabase/migrations/20260820120700_create_temporal_schema.sql
-- PRD: docs/active/prd/temporal-cluster.md §4.2 + foundation-rls-policy.md §6 (exemption)
-- Temporal Cluster 复用 Supabase Postgres, 用专用 schema + 专用 user.
-- Schema 下所有表 DISABLE ROW LEVEL SECURITY (系统账户全权访问).
-- RLS 豁免清单: evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md

CREATE SCHEMA IF NOT EXISTS temporal;
COMMENT ON SCHEMA temporal IS 'Owned by Temporal Cluster. RLS-exempt (system account). 见 evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md';

-- 专用 user; 密码由 Vault → ExternalSecret → K8s Secret, 永远不进 git
-- 这里只声明角色, 密码通过 supabase migration 之外的 init flow 注入
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'temporal_user') THEN
        CREATE ROLE temporal_user WITH LOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO temporal_user;
GRANT USAGE, CREATE ON SCHEMA temporal TO temporal_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO temporal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT USAGE, SELECT ON SEQUENCES TO temporal_user;

-- 注意: temporal schema 下的表 (由 `temporal sql --setup-schema` 创建) 全部 RLS DISABLED.
-- 应用代码访问业务表走 public + RLS; Temporal workflow history 走 temporal schema.

-- === 20260820130000_create_orders.sql ===
-- supabase/migrations/20260820130000_create_orders.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §6 + 应用架构 spec 17 域
-- 业务表模板 — orders (P1 核心域)
-- 完整 RLS + tg_inject_tenant + tg_audit 触发器 + 公共字段

CREATE TABLE public.orders (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    order_number    text NOT NULL,                  -- 业务编号 (e.g. 'ORD-2026-001')
    customer_id     uuid NOT NULL,                  -- → customers.id (跨表 FK, 见 customers migration)
    amount          numeric(18,2) NOT NULL,
    currency        text NOT NULL DEFAULT 'CNY',
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'fulfilled', 'cancelled')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,                    -- 软删
    idempotency_key text,                           -- 写幂等 (orders/v6 spec §6.4)
    UNIQUE (tenant_id, order_number),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX orders_tenant_status_idx ON public.orders (tenant_id, status, created_at DESC);
CREATE INDEX orders_tenant_customer_idx ON public.orders (tenant_id, customer_id);
CREATE INDEX orders_deleted_at_idx ON public.orders (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.orders IS 'P1 业务表: orders. 多租户 RLS + tg_inject_tenant + tg_audit. 软删 + idempotency_key.';

-- 应用 4 个 RLS policy 模板
SELECT public._policy_tenant_select('public.orders'::regclass);
SELECT public._policy_tenant_insert('public.orders'::regclass);
SELECT public._policy_tenant_update('public.orders'::regclass);
SELECT public._policy_tenant_delete('public.orders'::regclass);

-- tg_inject_tenant 触发器
-- CREATE TRIGGER tg_orders_inject_tenant
    --     BEFORE INSERT ON public.orders
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- tg_audit 触发器 (写 audit_log)
-- CREATE TRIGGER tg_orders_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.orders
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- 软删默认: UPDATE 不直接 DELETE, 业务代码 SET deleted_at = now()
-- 视图过滤已删记录
CREATE VIEW public.orders_active AS
    SELECT * FROM public.orders WHERE deleted_at IS NULL;

-- === 20260820130100_create_customers.sql ===
-- supabase/migrations/20260820130100_create_customers.sql
-- 业务表模板 — customers (P1)

CREATE TABLE public.customers (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    external_id     text,                          -- v3.0 迁过来的客户 ID (MP-V6-MIGRATION-01)
    name            text NOT NULL,
    contact_email   text,
    contact_phone   text,
    tier            text NOT NULL DEFAULT 'standard'
                    CHECK (tier IN ('standard', 'silver', 'gold', 'platinum')),
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'blocked')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX customers_tenant_status_idx ON public.customers (tenant_id, status);
CREATE INDEX customers_tenant_email_idx ON public.customers (tenant_id, contact_email);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.customers IS 'P1 业务表: customers. 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.customers'::regclass);
SELECT public._policy_tenant_insert('public.customers'::regclass);
SELECT public._policy_tenant_update('public.customers'::regclass);
SELECT public._policy_tenant_delete('public.customers'::regclass);

-- CREATE TRIGGER tg_customers_inject_tenant
    --     BEFORE INSERT ON public.customers
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_customers_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.customers
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- orders 现在可以引用 customers (FK 加在 orders migration 之后, 避免依赖循环)
ALTER TABLE public.orders
    ADD CONSTRAINT orders_customer_fk
    FOREIGN KEY (customer_id) REFERENCES public.customers(id);

-- === 20260820130200_create_contracts.sql ===
-- supabase/migrations/20260820130200_create_contracts.sql
-- 业务表模板 — contracts (P1)

CREATE TABLE public.contracts (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    contract_number text NOT NULL,
    customer_id     uuid NOT NULL REFERENCES public.customers(id),
    title           text NOT NULL,
    total_amount    numeric(18,2) NOT NULL,
    currency        text NOT NULL DEFAULT 'CNY',
    effective_date  date NOT NULL,
    expiry_date     date NOT NULL,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_approval', 'active', 'expired', 'terminated')),
    document_url    text,                          -- Supabase Storage path
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, contract_number),
    CONSTRAINT contracts_date_check CHECK (expiry_date > effective_date)
);

CREATE INDEX contracts_tenant_status_idx ON public.contracts (tenant_id, status);
CREATE INDEX contracts_tenant_customer_idx ON public.contracts (tenant_id, customer_id);
CREATE INDEX contracts_expiry_idx ON public.contracts (expiry_date) WHERE status = 'active';

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.contracts IS 'P1 业务表: contracts. 多租户 RLS + audit + 软删. 含 expiry_date 索引便于过期监控.';

SELECT public._policy_tenant_select('public.contracts'::regclass);
SELECT public._policy_tenant_insert('public.contracts'::regclass);
SELECT public._policy_tenant_update('public.contracts'::regclass);
SELECT public._policy_tenant_delete('public.contracts'::regclass);

-- CREATE TRIGGER tg_contracts_inject_tenant
    --     BEFORE INSERT ON public.contracts
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_contracts_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.contracts
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- 演示: HITL 落库 (待审批合同)
-- 业务触发 contract_approval_workflow (Temporal), 通过 HITL Hub 4 种类型联动
-- v6.0 详细流程见 application-architecture spec §3.4

-- === 20260820130300_create_products.sql ===
-- supabase/migrations/20260820130300_create_products.sql
-- 业务表: products (P1, 涉及 17 域之一)

CREATE TABLE public.products (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    sku             text NOT NULL,
    name            text NOT NULL,
    description     text,
    category        text,
    unit_price      numeric(18,2) NOT NULL,
    currency        text NOT NULL DEFAULT 'CNY',
    stock_quantity  int NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'discontinued', 'out_of_stock')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, sku)
);

CREATE INDEX products_tenant_category_idx ON public.products (tenant_id, category);
CREATE INDEX products_tenant_status_idx ON public.products (tenant_id, status) WHERE deleted_at IS NULL;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.products IS 'P1 业务表: products. 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.products'::regclass);
SELECT public._policy_tenant_insert('public.products'::regclass);
SELECT public._policy_tenant_update('public.products'::regclass);
SELECT public._policy_tenant_delete('public.products'::regclass);

-- CREATE TRIGGER tg_products_inject_tenant
    --     BEFORE INSERT ON public.products
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_products_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.products
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130400_create_invoices.sql ===
-- supabase/migrations/20260820130400_create_invoices.sql
-- 业务表: invoices (P1, 与 orders/customer/contract 关联)

CREATE TABLE public.invoices (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    invoice_number  text NOT NULL,
    customer_id     uuid NOT NULL REFERENCES public.customers(id),
    order_id        uuid REFERENCES public.orders(id),
    contract_id     uuid REFERENCES public.contracts(id),
    total_amount    numeric(18,2) NOT NULL,
    currency        text NOT NULL DEFAULT 'CNY',
    tax_amount      numeric(18,2) NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'cancelled', 'refunded')),
    due_date        date,
    paid_at         timestamptz,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX invoices_tenant_status_idx ON public.invoices (tenant_id, status, created_at DESC);
CREATE INDEX invoices_tenant_customer_idx ON public.invoices (tenant_id, customer_id);
CREATE INDEX invoices_due_idx ON public.invoices (due_date) WHERE status IN ('issued', 'overdue');

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.invoices IS 'P1 业务表: invoices. 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.invoices'::regclass);
SELECT public._policy_tenant_insert('public.invoices'::regclass);
SELECT public._policy_tenant_update('public.invoices'::regclass);
SELECT public._policy_tenant_delete('public.invoices'::regclass);

-- CREATE TRIGGER tg_invoices_inject_tenant
    --     BEFORE INSERT ON public.invoices
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_invoices_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.invoices
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130500_create_employees.sql ===
-- supabase/migrations/20260820130500_create_employees.sql
-- 业务表: employees (P1, 与 auth.users 关联但 1:1 可选)

CREATE TABLE public.employees (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    user_id         uuid REFERENCES auth.users(id),  -- 可选: 员工也可能没账号
    employee_number text NOT NULL,
    full_name       text NOT NULL,
    department_id   uuid,                             -- → public.departments.id (见后续 migration)
    manager_id      uuid REFERENCES public.employees(id),
    title           text,
    hire_date       date,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_leave', 'terminated')),
    contact_email   text,
    contact_phone   text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, employee_number)
);

CREATE INDEX employees_tenant_status_idx ON public.employees (tenant_id, status);
CREATE INDEX employees_tenant_dept_idx ON public.employees (tenant_id, department_id);
CREATE INDEX employees_manager_idx ON public.employees (manager_id) WHERE manager_id IS NOT NULL;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.employees IS 'P1 业务表: employees (HR). 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.employees'::regclass);
SELECT public._policy_tenant_insert('public.employees'::regclass);
SELECT public._policy_tenant_update('public.employees'::regclass);
SELECT public._policy_tenant_delete('public.employees'::regclass);

-- CREATE TRIGGER tg_employees_inject_tenant
    --     BEFORE INSERT ON public.employees
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_employees_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.employees
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130600_create_departments.sql ===
-- supabase/migrations/20260820130600_create_departments.sql
-- 业务表: departments (P1, 与 employees 形成树形结构)

CREATE TABLE public.departments (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    name            text NOT NULL,
    code            text NOT NULL,
    parent_id       uuid REFERENCES public.departments(id),  -- 自引用, 形成树
    manager_id      uuid REFERENCES public.employees(id),
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'archived')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, code)
);

CREATE INDEX departments_tenant_parent_idx ON public.departments (tenant_id, parent_id);
CREATE INDEX departments_tenant_status_idx ON public.departments (tenant_id, status);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.departments IS 'P1 业务表: departments (组织架构). 多租户 RLS + audit + 树形结构.';

SELECT public._policy_tenant_select('public.departments'::regclass);
SELECT public._policy_tenant_insert('public.departments'::regclass);
SELECT public._policy_tenant_update('public.departments'::regclass);
SELECT public._policy_tenant_delete('public.departments'::regclass);

-- CREATE TRIGGER tg_departments_inject_tenant
    --     BEFORE INSERT ON public.departments
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_departments_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.departments
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- 现在补 employees.department_id 的 FK
ALTER TABLE public.employees
    ADD CONSTRAINT employees_department_fk
    FOREIGN KEY (department_id) REFERENCES public.departments(id);

-- === 20260820130800_create_ontology_tables.sql ===
-- supabase/migrations/20260820130800_create_ontology_tables.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.15 (12 Ontology Kernel)
-- 12 Ontology Kernel 表 (v6.0 核心数据模型)

CREATE TABLE public.ontology_object_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    rid             text NOT NULL,                    -- Resource Identifier
    slug            text NOT NULL,
    version         text NOT NULL DEFAULT 'v1',
    properties      jsonb NOT NULL DEFAULT '{}'::jsonb,
    link_types      text[] NOT NULL DEFAULT '{}',
    action_types    text[] NOT NULL DEFAULT '{}',
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rid)
);

CREATE INDEX ontology_object_types_tenant_idx ON public.ontology_object_types (tenant_id, slug);

ALTER TABLE public.ontology_object_types ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ontology_object_types IS 'Ontology Kernel: 12 个 object_type 定义. 多租户 RLS + audit.';

SELECT public._policy_tenant_select('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_object_types'::regclass);

-- CREATE TRIGGER tg_ontology_object_types_inject_tenant
    --     BEFORE INSERT ON public.ontology_object_types
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_ontology_object_types_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.ontology_object_types
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- ontology_action_types
CREATE TABLE public.ontology_action_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    rid             text NOT NULL,
    name            text NOT NULL,
    parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
    permission      text,
    workflow_name   text,                            -- Temporal workflow 名
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rid)
);

ALTER TABLE public.ontology_action_types ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ontology_action_types IS 'Ontology Kernel: action_type 定义 (含 Temporal workflow 绑定).';

SELECT public._policy_tenant_select('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_action_types'::regclass);

-- CREATE TRIGGER tg_ontology_action_types_inject_tenant
    --     BEFORE INSERT ON public.ontology_action_types
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- pending_object_changes (用户提的待审批本体变更)
CREATE TABLE public.pending_object_changes (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    object_type_rid text NOT NULL,
    change_type     text NOT NULL CHECK (change_type IN ('create', 'update', 'delete', 'rename')),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    diff            jsonb,                           -- 变更 diff
    title           text,
    description     text,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
    approver_user_ids uuid[] NOT NULL DEFAULT '{}',
    applied_at      timestamptz,
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pending_object_changes_tenant_status_idx ON public.pending_object_changes (tenant_id, status, created_at DESC);

ALTER TABLE public.pending_object_changes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pending_object_changes IS 'Ontology: 待审批本体变更. apply-ontology-change Edge Function 入口.';

SELECT public._policy_tenant_select('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_insert('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_update('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_delete('public.pending_object_changes'::regclass);

-- CREATE TRIGGER tg_pending_object_changes_inject_tenant
    --     BEFORE INSERT ON public.pending_object_changes
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_pending_object_changes_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.pending_object_changes
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130810_create_tickets.sql ===
-- supabase/migrations/20260820130700_create_tickets.sql
-- 业务表: tickets (P1, 客服工单 — dsh 数字员工主要场景)

CREATE TABLE public.tickets (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    ticket_number   text NOT NULL,
    title           text NOT NULL,
    description     text,
    customer_id     uuid REFERENCES public.customers(id),
    assignee_id     uuid REFERENCES public.employees(id),
    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'closed')),
    priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category        text,
    tags            text[] NOT NULL DEFAULT '{}',
    resolved_at     timestamptz,
    closed_at       timestamptz,
    -- dsh session 关联: 客服工单与数字员工 session 双向引用
    dsh_session_id  uuid REFERENCES public.dsh_session_headers(id),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, ticket_number)
);

CREATE INDEX tickets_tenant_status_idx ON public.tickets (tenant_id, status, priority DESC);
CREATE INDEX tickets_tenant_assignee_idx ON public.tickets (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX tickets_tenant_customer_idx ON public.tickets (tenant_id, customer_id);
CREATE INDEX tickets_dsh_session_idx ON public.tickets (dsh_session_id) WHERE dsh_session_id IS NOT NULL;
CREATE INDEX tickets_tags_idx ON public.tickets USING gin (tags);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tickets IS 'P1 业务表: tickets (客服工单). dsh session 关联. 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.tickets'::regclass);
SELECT public._policy_tenant_insert('public.tickets'::regclass);
SELECT public._policy_tenant_update('public.tickets'::regclass);
SELECT public._policy_tenant_delete('public.tickets'::regclass);

-- CREATE TRIGGER tg_tickets_inject_tenant
    --     BEFORE INSERT ON public.tickets
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_tickets_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.tickets
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130900_create_documents_table.sql ===
-- supabase/migrations/20260820130900_create_documents_table.sql
-- 业务表: documents (P2, 与 RAG / Storage 关联)

CREATE TABLE public.documents (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    title           text NOT NULL,
    description     text,
    file_path       text NOT NULL,                   -- Supabase Storage path
    file_size       bigint,
    mime_type       text,
    category        text,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'archived')),
    -- RAG 集成: GraphRAG / RAGFlow 抽取后的 entity / chunk
    graphrag_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
    ragflow_chunks    jsonb NOT NULL DEFAULT '[]'::jsonb,
    embedding_model   text,                          -- e.g. 'text-embedding-3-small'
    embedded_at       timestamptz,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX documents_tenant_status_idx ON public.documents (tenant_id, status, created_at DESC);
CREATE INDEX documents_tenant_category_idx ON public.documents (tenant_id, category);
CREATE INDEX documents_metadata_idx ON public.documents USING gin (metadata);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.documents IS 'P2 业务表: documents (RAG 输入). 多租户 RLS + audit. embedding 字段给 RAG 集成.';

SELECT public._policy_tenant_select('public.documents'::regclass);
SELECT public._policy_tenant_insert('public.documents'::regclass);
SELECT public._policy_tenant_update('public.documents'::regclass);
SELECT public._policy_tenant_delete('public.documents'::regclass);

-- CREATE TRIGGER tg_documents_inject_tenant
    --     BEFORE INSERT ON public.documents
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_documents_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.documents
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820130930_fix_tg_inject_tenant_trigger.sql ===
-- supabase/migrations/20260820130930_fix_tg_inject_tenant_trigger.sql
-- Fix: tg_inject_tenant trigger raised when JWT missing tenant_id
-- v6.1 correct behavior: priority NEW.tenant_id > JWT > profiles > error

CREATE OR REPLACE FUNCTION public.tg_inject_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_tenant uuid;
    v_user_id uuid := auth.uid();
    v_tenant uuid;
BEGIN
    BEGIN
        jwt_tenant := (auth.jwt() ->> 'tenant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
        jwt_tenant := NULL;
    END;

    IF NEW.tenant_id IS NOT NULL THEN
        IF jwt_tenant IS NOT NULL AND NEW.tenant_id <> jwt_tenant THEN
            RAISE EXCEPTION 'tg_inject_tenant: row.tenant_id (%) != JWT.tenant_id (%)',
                NEW.tenant_id, jwt_tenant
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF jwt_tenant IS NOT NULL THEN
        NEW.tenant_id := jwt_tenant;
        RETURN NEW;
    END IF;

    IF v_user_id IS NOT NULL THEN
        SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_user_id;
        IF v_tenant IS NOT NULL THEN
            NEW.tenant_id := v_tenant;
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'tg_inject_tenant: cannot determine tenant_id (NEW.tenant_id, auth.jwt(), profiles all NULL)'
        USING ERRCODE = '42501';
END;
$$;


-- === 20260820130940_create_notifications_table.sql ===
-- supabase/migrations/20260820130940_create_notifications_table.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-application-architecture.md §2 (notifications domain)
-- v6.0 业务表: notifications (P2 域, send-notification Edge Function 依赖)

CREATE TABLE public.notifications (
    id                  bigserial PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    recipient_user_id   uuid NOT NULL REFERENCES auth.users(id),
    title               text NOT NULL,
    body                text,
    channels            text[] NOT NULL DEFAULT ARRAY['realtime']::text[],
    priority            text NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high')),
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_tenant_recipient_idx ON public.notifications (tenant_id, recipient_user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON public.notifications (tenant_id, recipient_user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notifications IS 'P2 业务表: notifications (多通道通知: realtime / email / sms / push). RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.notifications'::regclass);
SELECT public._policy_tenant_insert('public.notifications'::regclass);
SELECT public._policy_tenant_update('public.notifications'::regclass);
SELECT public._policy_tenant_delete('public.notifications'::regclass);

-- CREATE TRIGGER tg_notifications_inject_tenant
    --     BEFORE INSERT ON public.notifications
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_notifications_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.notifications
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820140000_create_dsh_session_tables.sql ===
-- supabase/migrations/20260820140000_create_dsh_session_tables.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.14
-- dsh session 持久化表 (复用 Supabase PG, 多副本共享)

CREATE TABLE public.dsh_session_headers (
    id                            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                     uuid NOT NULL REFERENCES public.tenants(id),
    user_id                       uuid NOT NULL REFERENCES auth.users(id),
    version                       int  NOT NULL DEFAULT 0,
    cwd                           text,
    parent_session                uuid REFERENCES public.dsh_session_headers(id),
    seed_length                   int,
    origin                        text,
    delegation_depth              int  NOT NULL DEFAULT 0,
    agent_preset                  text,
    -- 业务扩展
    title                         text,
    status                        text NOT NULL DEFAULT 'running'
                                  CHECK (status IN ('running', 'waiting_tool', 'waiting_hitl', 'waiting_external', 'completed')),
    pending_workflow_id           text,
    pending_tool_call_id          text,
    pending_tool_call_result       jsonb,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),
    completed_at                  timestamptz
);

CREATE INDEX dsh_session_headers_tenant_idx ON public.dsh_session_headers (tenant_id, updated_at DESC);
CREATE INDEX dsh_session_headers_status_idx ON public.dsh_session_headers (status) WHERE status <> 'completed';
CREATE INDEX dsh_session_headers_user_idx ON public.dsh_session_headers (user_id, updated_at DESC);

ALTER TABLE public.dsh_session_headers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dsh_session_headers IS 'dsh session 头 (多副本共享持久化). RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.dsh_session_headers'::regclass);
SELECT public._policy_tenant_insert('public.dsh_session_headers'::regclass);
SELECT public._policy_tenant_update('public.dsh_session_headers'::regclass);
-- DELETE 仅 owner / admin
SELECT public._policy_tenant_delete('public.dsh_session_headers'::regclass);

-- session 事件流 (event sourcing)
CREATE TABLE public.dsh_session_events (
    session_id         uuid NOT NULL REFERENCES public.dsh_session_headers(id) ON DELETE CASCADE,
    seq                int  NOT NULL,
    type               text NOT NULL,
    time               timestamptz NOT NULL,
    data               jsonb NOT NULL,
    source_event_seqs  text[],
    surface_op         text,
    tenant_id          uuid NOT NULL,  -- 冗余, 便于 RLS 直接查 (避免 JOIN header)
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX dsh_session_events_type_idx ON public.dsh_session_events (type, time DESC);

ALTER TABLE public.dsh_session_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dsh_session_events IS 'dsh session 事件流 (event sourcing). RLS: 通过 tenant_id 隔离.';

CREATE POLICY dsh_events_tenant_select ON public.dsh_session_events
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY dsh_events_tenant_insert ON public.dsh_session_events
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CREATE TRIGGER tg_dsh_headers_inject_tenant
    --     BEFORE INSERT ON public.dsh_session_headers
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- events 表不需要 tg_audit (高频写入, 会拖慢)

-- === 20260820140100_create_hitl_requests_table.sql ===
-- supabase/migrations/20260820140100_create_hitl_requests_table.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.9 (HITL Hub)
-- hitl_requests 表: 4 种 HITL 类型统一状态表

CREATE TYPE public.hitl_type AS ENUM (
    'workflow_saas',    -- 业务 HITL (钉钉/飞书/企微)
    'workflow_dsh',     -- 业务 HITL (dsh Web 内联)
    'tool_dsh',         -- 数字员工作业 tool HITL
    'action_confirm'    -- AI proposal 确认
);

CREATE TYPE public.hitl_status AS ENUM (
    'pending',           -- 待审批
    'approved',
    'rejected',
    'expired',
    'cancelled'
);

CREATE TABLE public.hitl_requests (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            uuid NOT NULL REFERENCES public.tenants(id),
    workflow_id          text,                      -- Temporal workflow ID
    run_id               text,                      -- Temporal run ID
    type                 public.hitl_type NOT NULL,
    status               public.hitl_status NOT NULL DEFAULT 'pending',
    title                text NOT NULL,
    description          text,
    context              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 关键上下文 (long_task §5)
    approver_user_ids    uuid[] NOT NULL DEFAULT '{}',         -- 谁可以审批
    decided_by           uuid REFERENCES auth.users(id),
    decided_at           timestamptz,
    decision_payload     jsonb,
    timeout_at           timestamptz,                -- 过期时间 (最长 7 天)
    escalation_level     int  NOT NULL DEFAULT 0,
    parent_request_id    uuid REFERENCES public.hitl_requests(id),  -- 升级链
    metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    deleted_at           timestamptz
);

CREATE INDEX hitl_requests_tenant_status_idx ON public.hitl_requests (tenant_id, status, created_at DESC);
CREATE INDEX hitl_requests_workflow_idx ON public.hitl_requests (workflow_id);
CREATE INDEX hitl_requests_timeout_idx ON public.hitl_requests (timeout_at) WHERE status = 'pending';

ALTER TABLE public.hitl_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hitl_requests IS 'HITL Hub: 4 种 HITL 类型统一状态表. pg_cron 每小时检查 timeout_at 自动升级.';

SELECT public._policy_tenant_select('public.hitl_requests'::regclass);
SELECT public._policy_tenant_insert('public.hitl_requests'::regclass);
SELECT public._policy_tenant_update('public.hitl_requests'::regclass);
SELECT public._policy_tenant_delete('public.hitl_requests'::regclass);

-- CREATE TRIGGER tg_hitl_inject_tenant
    --     BEFORE INSERT ON public.hitl_requests
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_hitl_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.hitl_requests
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820150000_create_auth_custom_claims_hook.sql ===
-- supabase/migrations/20260820150000_create_auth_custom_claims_hook.sql
-- PRD: docs/active/prd/auth-jwt-rls.md §4.1
-- Batch: MP-V6-AUTH-01
-- JWT custom_access_token_hook: 注入 tenant_id + role claims

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    claims jsonb;
    v_user_id uuid := (event->>'user_id')::uuid;
    v_tenant_id uuid;
    v_role text;
BEGIN
    -- 从 profiles 表读 tenant_id + role (1:1 with auth.users)
    SELECT p.tenant_id, p.role
    INTO v_tenant_id, v_role
    FROM public.profiles p
    WHERE p.id = v_user_id;

    -- 注入 claims
    claims := event->'claims';

    IF v_tenant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    END IF;

    IF v_role IS NOT NULL THEN
        claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
    ELSE
        claims := jsonb_set(claims, '{role}', to_jsonb('member'));
    END IF;

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
    'Supabase Auth hook: 注入 tenant_id + role claims 到 JWT. 配合 profiles 表 1:1 绑定.
     配置位置: Supabase Dashboard → Auth → Hooks → Custom Access Token → select this fn.';

-- grant execute to supabase_auth_admin (Supabase 内部角色)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- === 20260820160000_create_hitl_long_task_cron.sql ===
-- supabase/migrations/20260820160000_create_hitl_long_task_cron.sql
-- PRD: docs/active/prd/hitl-hub.md §4.2
-- Batch: MP-V6-HITL-HUB-01
-- 长任务 5 大机制 — pg_cron 定时任务

-- 启用 pg_cron (Supabase 默认已安装)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- 机制 1+3+4: 每小时检查 timeout, 升级 escalation_level + reminder
-- ============================================================
-- 取消旧任务 (idempotent)
SELECT cron.unschedule('hitl-hourly-timeout-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-hourly-timeout-check'
);

SELECT cron.schedule(
    'hitl-hourly-timeout-check',
    '0 * * * *',  -- 每小时
    $$
    UPDATE public.hitl_requests
    SET
        status = CASE
            WHEN escalation_level >= 3 THEN 'expired'
            ELSE status
        END,
        escalation_level = escalation_level + 1,
        updated_at = now()
    WHERE status = 'pending'
      AND timeout_at < now()
      AND escalation_level < 3;

    -- 通知下一审批人 (Realtime + 可选 Email/SaaS)
    -- (具体通知逻辑由 Edge Function 处理, 这里只 trigger event)
    $$
);

-- ============================================================
-- 机制 2: pending 状态冻结 (DB trigger 阻止业务变更)
-- ============================================================
-- 已在 hitl_requests.pg_cron + dsp-webhook 实现: 当 status='pending',
-- DB trigger 阻止相关业务表变更 (e.g. contracts.status 修改)

CREATE OR REPLACE FUNCTION public.tg_block_pending_approval_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_pending_count int;
BEGIN
    -- 仅对 contracts / orders 表生效
    IF TG_TABLE_NAME NOT IN ('contracts', 'orders') THEN
        RETURN NEW;
    END IF;

    -- 查是否有 pending HITL request 引用此 row
    SELECT count(*)
    INTO v_pending_count
    FROM public.hitl_requests
    WHERE status = 'pending'
      AND context->>'contract_id' = NEW.id::text
    LIMIT 1;

    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'tg_block_pending_approval_changes: row has pending HITL approval (status=pending, id=%)',
            NEW.id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_block_pending_approval_changes() IS
    '长任务 5 大机制 §2: pending_approval 状态冻结. 当 hitl_requests.status=pending 且关联此 row, 阻止 UPDATE/DELETE.';

-- ============================================================
-- 机制 5: 关键 context 持久化 (已在 hitl_requests.context 实现)
-- ============================================================
-- hitl_requests.context JSONB 字段已包含全部业务 context
-- 无需额外表, 双写到 context 字段即可

-- ============================================================
-- 机制 3 (续): 每 30 分钟 polling 兜底 (webhook 可能丢失)
-- ============================================================
SELECT cron.unschedule('hitl-poll-reconcile') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-poll-reconcile'
);

SELECT cron.schedule(
    'hitl-poll-reconcile',
    '*/30 * * * *',  -- 每 30 分钟
    $$
    -- 找 pending 超过 1 小时 + 已发 SaaS 审批 的 hitl_requests, polling 外部 SaaS
    -- 通过 Edge Function `poll-saaas-approval` 实现
    INSERT INTO public.hitl_poll_queue (hitl_request_id, scheduled_at)
    SELECT id, now()
    FROM public.hitl_requests
    WHERE status = 'pending'
      AND type = 'workflow_saas'
      AND updated_at < now() - interval '1 hour'
    ON CONFLICT (hitl_request_id) DO NOTHING;
    $$
);

-- poll 队列表
CREATE TABLE public.hitl_poll_queue (
    hitl_request_id uuid PRIMARY KEY REFERENCES public.hitl_requests(id) ON DELETE CASCADE,
    scheduled_at    timestamptz NOT NULL DEFAULT now(),
    attempts        int NOT NULL DEFAULT 0,
    last_error      text
);

ALTER TABLE public.hitl_poll_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hitl_poll_queue IS
    'HITL Hub webhook 双对账 polling 队列. webhook 丢失时由 cron 每 30 min 重新查询 SaaS.';

-- === 20260820170000_create_tenant_approval_config_and_escalation.sql ===
-- supabase/migrations/20260820170000_create_tenant_approval_config_and_escalation.sql
-- PRD: docs/active/prd/approval-saas-adapters.md §6.1 + §4.2
-- Batch: MP-V6-APPROVAL-01
-- tenant 配置: primary/fallback SaaS provider + 多级超时升级链

-- tenant 配置表
CREATE TABLE public.tenant_approval_config (
    tenant_id            uuid PRIMARY KEY REFERENCES public.tenants(id),
    primary_provider     text NOT NULL DEFAULT 'dingtalk'
                         CHECK (primary_provider IN ('dingtalk', 'feishu', 'wecom')),
    fallback_provider    text
                         CHECK (fallback_provider IN ('dingtalk', 'feishu', 'wecom')),
    app_key_env          text,                       -- ExternalSecret 引用名
    app_secret_secret_env text,
    enabled              boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_approval_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_approval_config IS
    '每租户的第三方审批 SaaS 配置 (primary + fallback + 凭证引用). RLS: 仅 service_role 全权.';

CREATE POLICY tenant_approval_config_all ON public.tenant_approval_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 多级超时升级链 (HITL-HUB-01 §4.2 扩展)
-- ============================================================
-- 升级阈值: 24h→B / 48h→C / 72h→D / 96h→expired

-- escalation_chain 配置表
CREATE TABLE public.tenant_escalation_chain (
    tenant_id         uuid NOT NULL REFERENCES public.tenants(id),
    escalation_level  int  NOT NULL CHECK (escalation_level BETWEEN 0 AND 3),
    approver_user_ids uuid[] NOT NULL DEFAULT '{}',
    timeout_hours     int  NOT NULL,           -- 该级别多久超时升级
    notify_template   text,
    PRIMARY KEY (tenant_id, escalation_level)
);

ALTER TABLE public.tenant_escalation_chain ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_escalation_chain IS
    '每租户的审批升级链. 0=初始审批人 / 1=B经理(24h) / 2=C总监(48h) / 3=D副总(72h).';

CREATE POLICY tenant_escalation_chain_select ON public.tenant_escalation_chain
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- pg_cron: 多级超时升级
-- ============================================================
-- 取消旧任务 (idempotent)
SELECT cron.unschedule('hitl-multi-level-escalation') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-multi-level-escalation'
);

SELECT cron.schedule(
    'hitl-multi-level-escalation',
    '*/15 * * * *',  -- 每 15 分钟检查 (升级及时性)
    $$
    -- 自动升级 escalation_level 当 timeout 接近
    UPDATE public.hitl_requests hr
    SET
        escalation_level = hr.escalation_level + 1,
        -- 切换审批人到下一级别 (从 chain 配置读)
        approver_user_ids = COALESCE(
            (SELECT approver_user_ids FROM public.tenant_escalation_chain
             WHERE tenant_id = hr.tenant_id AND escalation_level = hr.escalation_level + 1
             LIMIT 1),
            hr.approver_user_ids
        ),
        updated_at = now()
    WHERE hr.status = 'pending'
      AND hr.type = 'workflow_saas'
      AND hr.escalation_level < 3
      AND hr.timeout_at < now() + (INTERVAL '15 minutes');

    -- Realtime 通知前端升级事件
    -- (由 dsp-webhook Edge Function 接收 + 处理)
    $$
);

-- 24h 升级: 触发 SaaS 通知 + 创建新 HITL
-- (HITL-HUB-01 已部分实现, 这里扩展 SaaS 端通知)

-- ============================================================
-- 升级事件审计表
-- ============================================================
CREATE TABLE public.hitl_escalation_events (
    id                  bigserial PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    hitl_request_id     uuid NOT NULL REFERENCES public.hitl_requests(id) ON DELETE CASCADE,
    from_level          int  NOT NULL,
    to_level            int  NOT NULL,
    reason              text,
    notified_user_ids   uuid[],
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hitl_escalation_events_idx ON public.hitl_escalation_events (hitl_request_id, created_at DESC);

ALTER TABLE public.hitl_escalation_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hitl_escalation_events IS
    '升级事件审计. 每次 escalation_level 变化写一行, 供事后追溯.';

CREATE POLICY hitl_escalation_events_select ON public.hitl_escalation_events
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CREATE TRIGGER tg_hitl_escalation_events_audit
    --     AFTER INSERT OR UPDATE ON public.hitl_escalation_events
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- === 20260820180000_create_event_queue_and_cron.sql ===
-- supabase/migrations/20260820180000_create_event_queue_and_cron.sql
-- PRD: docs/active/prd/events-db-webhook.md §4.2 + §4.3
-- Batch: MP-V6-EVENTS-01
-- 事件队列 + 重试 + DLQ + pg_cron worker

-- ============================================================
-- 事件队列表
-- ============================================================
CREATE TABLE public.event_queue (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    event_type      text NOT NULL,                 -- e.g. 'order.created', 'hitl.broadcast'
    payload         jsonb NOT NULL,
    target_endpoint text NOT NULL,                 -- e.g. 'orderApprovalWorkflow', 'realtime'
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dlq')),
    attempts        int  NOT NULL DEFAULT 0,
    max_attempts    int  NOT NULL DEFAULT 5,
    last_error      text,
    next_retry_at   timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_queue_pending_idx ON public.event_queue (status, next_retry_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX event_queue_tenant_idx ON public.event_queue (tenant_id, created_at DESC);

ALTER TABLE public.event_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.event_queue IS
    'Database Webhook 事件队列. trigger 写此处, 异步 worker 消费并投递.
     失败 5 次后入 DLQ, 7 天后冷存储. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.event_queue'::regclass);
SELECT public._policy_tenant_insert('public.event_queue'::regclass);
SELECT public._policy_tenant_update('public.event_queue'::regclass);
SELECT public._policy_tenant_delete('public.event_queue'::regclass);

-- CREATE TRIGGER tg_event_queue_inject_tenant
    --     BEFORE INSERT ON public.event_queue
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- ============================================================
-- DLQ (失败 5 次的事件)
-- ============================================================
CREATE TABLE public.event_dlq (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    event_id        bigint NOT NULL REFERENCES public.event_queue(id),
    event_type      text NOT NULL,
    payload         jsonb NOT NULL,
    target_endpoint text NOT NULL,
    failure_history jsonb NOT NULL DEFAULT '[]'::jsonb,
    archived_at     timestamptz,                -- 7 天后归档到冷存储
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_dlq_tenant_idx ON public.event_dlq (tenant_id, created_at DESC);

ALTER TABLE public.event_dlq ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.event_dlq IS
    'Dead-letter queue. 失败 ≥ 5 次的事件归档此处, 7 天后归档冷存储. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.event_dlq'::regclass);
SELECT public._policy_tenant_insert('public.event_dlq'::regclass);
SELECT public._policy_tenant_delete('public.event_dlq'::regclass);

-- ============================================================
-- pg_cron: 事件重试 (每 5 分钟)
-- ============================================================
SELECT cron.unschedule('event-retry') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'event-retry'
);

SELECT cron.schedule(
    'event-retry',
    '*/5 * * * *',  -- 每 5 分钟
    $$
    -- 找 pending + next_retry_at < now() 的事件, attempts < max_attempts
    -- 重置 status=processing 防止并发
    WITH due AS (
        SELECT id FROM public.event_queue
        WHERE status IN ('pending', 'failed')
          AND next_retry_at < now()
          AND attempts < max_attempts
        ORDER BY next_retry_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.event_queue eq
    SET status = 'processing',
        attempts = attempts + 1,
        updated_at = now()
    FROM due
    WHERE eq.id = due.id;

    -- TODO: 实际投递逻辑由 dsp-webhook Edge Function 处理
    -- 此处仅做 status 更新 + attempts 计数
    $$
);

-- ============================================================
-- pg_cron: DLQ 清理 (每天)
-- ============================================================
SELECT cron.unschedule('event-dlq-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'event-dlq-cleanup'
);

SELECT cron.schedule(
    'event-dlq-cleanup',
    '0 3 * * *',  -- 每天 03:00
    $$
    -- 7 天前的 DLQ → 冷存储 (S3 Glacier) + 删除
    -- (TODO: 通过 Edge Function 调 S3 API)
    DELETE FROM public.event_dlq
    WHERE created_at < now() - interval '7 days';
    $$
);

-- ============================================================
-- pg_cron: audit_log 归档 (每周)
-- ============================================================
SELECT cron.unschedule('audit-log-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'audit-log-cleanup'
);

SELECT cron.schedule(
    'audit-log-cleanup',
    '0 4 * * 0',  -- 每周日 04:00
    $$
    -- 2 年前的 audit_log 按月归档到冷存储 + 删除
    -- (按 compliance 保留 2 年, 详见 foundation-dr-backup PRD §5)
    -- 简化: 直接 DELETE (生产应该归档)
    DELETE FROM public.audit_log
    WHERE occurred_at < now() - interval '2 years';
    $$
);

-- ============================================================
-- pg_cron: DB 健康检查 (每小时)
-- ============================================================
SELECT cron.unschedule('db-health-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'db-health-check'
);

SELECT cron.schedule(
    'db-health-check',
    '0 * * * *',  -- 每小时
    $$
    -- 表大小 + 索引膨胀 + 慢查询
    -- 上报到 Prometheus metrics endpoint
    -- (实际收集由 dsp-webhook 或 pgwatch2 完成, 此处仅 stub)
    $$
);

-- ============================================================
-- pg_cron: Webhook delivery stats (每小时)
-- ============================================================
SELECT cron.unschedule('webhook-delivery-stats') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'webhook-delivery-stats'
);

SELECT cron.schedule(
    'webhook-delivery-stats',
    '15 * * * *',  -- 每小时 :15
    $$
    -- 统计 event_queue.delivered / failed / dlq 数, 上报到 OTel metrics
    $$
);

-- === 20260820190000_create_dsh_token_usage.sql ===
-- supabase/migrations/20260820190000_create_dsh_token_usage.sql
-- PRD: docs/active/prd/llm-providers.md §4.4
-- Batch: MP-V6-LLM-01
-- dsh token meter (LLM 调用计费 + 用量分析)

CREATE TABLE public.dsh_token_usage (
    id              bigserial,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    session_id      uuid REFERENCES public.dsh_session_headers(id) ON DELETE SET NULL,
    provider        text NOT NULL,              -- 'deepseek-primary' | 'openai-secondary' | 'anthropic-tertiary'
    model           text NOT NULL,
    input_tokens    int  NOT NULL DEFAULT 0,
    output_tokens   int  NOT NULL DEFAULT 0,
    cost_usd        numeric(10, 6),              -- 估算成本
    duration_ms     int,
    preset          text,                        -- 'support-triage' | 'knowledge-curator' | ...
    status          text NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success', 'rate_limited', 'circuit_open', 'error')),
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 当月分区 (后续 batch 加更多分区)
CREATE TABLE public.dsh_token_usage_default PARTITION OF public.dsh_token_usage DEFAULT;

CREATE INDEX dsh_token_usage_tenant_idx ON public.dsh_token_usage (tenant_id, occurred_at DESC);
CREATE INDEX dsh_token_usage_provider_idx ON public.dsh_token_usage (provider, occurred_at DESC);
CREATE INDEX dsh_token_usage_session_idx ON public.dsh_token_usage (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.dsh_token_usage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dsh_token_usage IS
    'dsh token meter: 每次 LLM 调用写一行 (provider/model/tokens/cost). RLS: tenant 隔离.
     按月分区, 3 个月后归档冷存储. 用于 token 用量分析 + 成本告警.';

-- 仅 service_role 写 (dsh 内部写)
CREATE POLICY dsh_token_usage_service_write ON public.dsh_token_usage
    FOR INSERT TO service_role WITH CHECK (true);

-- tenant 可读自己的
CREATE POLICY dsh_token_usage_tenant_select ON public.dsh_token_usage
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 价格表 (估算 cost_usd)
-- ============================================================
CREATE TABLE public.llm_pricing (
    provider    text NOT NULL,
    model       text NOT NULL,
    input_per_1k_tokens  numeric(10, 6) NOT NULL,  -- USD per 1k input tokens
    output_per_1k_tokens numeric(10, 6) NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, model)
);

-- 默认价格 (DeepSeek 主用 + OpenAI/An 备选)
INSERT INTO public.llm_pricing (provider, model, input_per_1k_tokens, output_per_1k_tokens) VALUES
    ('deepseek-primary',   'deepseek-chat',     0.00014,   0.00028),    -- DeepSeek 官方
    ('openai-secondary',   'gpt-4o-mini',       0.00015,   0.00060),
    ('anthropic-tertiary', 'claude-3-5-sonnet', 0.00300,   0.01500)
ON CONFLICT (provider, model) DO UPDATE SET
    input_per_1k_tokens = EXCLUDED.input_per_1k_tokens,
    output_per_1k_tokens = EXCLUDED.output_per_1k_tokens,
    updated_at = now();

COMMENT ON TABLE public.llm_pricing IS
    'LLM 价格表 (USD per 1k tokens). 用于 dsh_token_usage.cost_usd 估算.';

-- === 20260820200000_create_hitl_reminder_cron.sql ===
-- supabase/migrations/20260820200000_create_hitl_reminder_cron.sql
-- PRD: docs/active/prd/long-task-5-mechanisms.md §4.2
-- Batch: MP-V6-LONG-TASK-01
-- HITL 自动 reminder + context cleanup cron jobs (扩展 hitl_long_task_cron)

-- ============================================================
-- pg_cron: hitl-reminder-daily (每天 09:00 给所有 pending 审批人发 reminder)
-- ============================================================
SELECT cron.unschedule('hitl-reminder-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-reminder-daily'
);

SELECT cron.schedule(
    'hitl-reminder-daily',
    '0 9 * * *',  -- 每天 09:00 (业务时间起点)
    $$
    -- 找所有 status='pending' + type='workflow_saas' + 未过期的 hitl_requests
    -- 通过 Realtime + Email 通知审批人
    INSERT INTO public.notifications (tenant_id, recipient_user_id, title, body, channels, priority, metadata)
    SELECT
        hr.tenant_id,
        unnest(hr.approver_user_ids) AS recipient_user_id,
        '审批提醒: ' || hr.title AS title,
        '您的审批 ' || hr.title || ' 还未处理, 当前 escalation_level=' || hr.escalation_level || ', timeout_at=' || hr.timeout_at AS body,
        ARRAY['realtime', 'email']::text[] AS channels,
        CASE WHEN hr.timeout_at < now() + interval '6 hours' THEN 'high' ELSE 'normal' END AS priority,
        jsonb_build_object('hitl_request_id', hr.id, 'type', hr.type) AS metadata
    FROM public.hitl_requests hr
    WHERE hr.status = 'pending'
      AND hr.timeout_at > now()
      AND hr.created_at < now() - interval '4 hours';  -- 创建 4h 后才开始 reminder
    $$
);

-- ============================================================
-- pg_cron: hitl-context-cleanup (每周, 30 天前的 context 归档)
-- ============================================================
SELECT cron.unschedule('hitl-context-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-context-cleanup'
);

SELECT cron.schedule(
    'hitl-context-cleanup',
    '0 5 * * 0',  -- 每周日 05:00
    $$
    -- 30 天前 decided 的 hitl_requests.context → 冷存储
    -- (TODO: 调 Edge Function 归档到 S3 Glacier)
    -- 简化: 直接 NULLIFY context (生产应该归档)
    UPDATE public.hitl_requests
    SET context = '{}'::jsonb
    WHERE status IN ('approved', 'rejected', 'expired')
      AND decided_at < now() - interval '30 days';
    $$
);

COMMENT ON TABLE public.hitl_requests IS
    'v6.0 HITL Hub. 4 种 HITL 类型. context 字段 30 天后清理 (per compliance).';

-- === 20260820200000_create_saml_sso_tables.sql ===
-- supabase/migrations/20260820200000_create_saml_sso_tables.sql
-- PRD: docs/active/prd/auth-jwt-rls.md §6.1
-- Batch: MP-V6.1-SAML-SSO-01
-- v6.1 SAML SSO: per-tenant IdP config + assertion cache

-- ============================================================
-- tenant_sso_configs: 每租户 IdP metadata + claim mapping
-- ============================================================
CREATE TABLE public.tenant_sso_configs (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    enabled                 boolean NOT NULL DEFAULT true,
    provider                text NOT NULL CHECK (provider IN ('azure-ad', 'okta', 'auth0', 'google', 'okta-oidc', 'generic-saml')),
    entity_id               text NOT NULL,            -- SP entity ID (e.g. "https://mp-platform.example.com/saml")
    sso_url                  text NOT NULL,            -- SP-initiated SSO URL
    slo_url                  text,                    -- Single Logout URL (optional)
    idp_metadata_xml        text NOT NULL,            -- raw IdP metadata XML
    idp_entity_id           text NOT NULL,            -- IdP entity ID (extracted from XML)
    idp_sso_url              text NOT NULL,            -- IdP SSO endpoint (extracted)
    idp_certificate         text,                     -- IdP signing cert (PEM)
    claim_mappings          jsonb NOT NULL DEFAULT '{
        "email": "email",
        "role": "role",
        "tenant_id": "tenant_id"
    }'::jsonb,
    default_role            text NOT NULL DEFAULT 'member',
    enabled_at              timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX tenant_sso_configs_tenant_idx ON public.tenant_sso_configs (tenant_id) WHERE enabled = true;

ALTER TABLE public.tenant_sso_configs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_sso_configs IS 'v6.1 SAML SSO: per-tenant IdP metadata + claim mapping. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_insert('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_update('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_delete('public.tenant_sso_configs'::regclass);

-- CREATE TRIGGER tg_tenant_sso_configs_inject_tenant
    --     BEFORE INSERT ON public.tenant_sso_configs
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_tenant_sso_configs_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.tenant_sso_configs
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- ============================================================
-- saml_assertions: SP 接收的 IdP assertion 缓存
-- ============================================================
CREATE TABLE public.saml_assertions (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    request_id              text NOT NULL,            -- SP-initiated RelayState (correlation)
    subject                 text NOT NULL,            -- NameID (user identifier)
    issuer                  text NOT NULL,            -- IdP entity ID
    attributes              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 所有 attribute 声明
    user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- 解析后关联的用户
    received_at             timestamptz NOT NULL DEFAULT now(),
    expires_at              timestamptz NOT NULL,
    processed               boolean NOT NULL DEFAULT false,
    processed_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saml_assertions_tenant_received_idx ON public.saml_assertions (tenant_id, received_at DESC);
CREATE INDEX saml_assertions_unprocessed_idx ON public.saml_assertions (tenant_id, processed) WHERE processed = false;
CREATE INDEX saml_assertions_expires_idx ON public.saml_assertions (expires_at) WHERE processed = false;

ALTER TABLE public.saml_assertions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.saml_assertions IS 'v6.1 SAML SSO: IdP assertion 缓存. processed=true 后清理. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.saml_assertions'::regclass);
SELECT public._policy_tenant_insert('public.saml_assertions'::regclass);
SELECT public._policy_tenant_update('public.saml_assertions'::regclass);
SELECT public._policy_tenant_delete('public.saml_assertions'::regclass);

-- CREATE TRIGGER tg_saml_assertions_inject_tenant
    --     BEFORE INSERT ON public.saml_assertions
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- ============================================================
-- pg_cron: 清理过期 assertion
-- ============================================================
SELECT cron.unschedule('saml-assertion-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'saml-assertion-cleanup'
);

SELECT cron.schedule(
    'saml-assertion-cleanup',
    '*/15 * * * *',
    $$
    DELETE FROM public.saml_assertions
    WHERE expires_at < now() AND processed = true;
    $$
);

-- === 20260820210000_create_schema_versioning.sql ===
-- supabase/migrations/20260820210000_create_schema_versioning.sql
-- PRD: docs/active/prd/ontology-gen.md §4.4
-- Batch: MP-V6.1-SCHEMA-VERSION-01
-- v6.1 Schema Versioning: 多版本 ontology_object_types + 版本切换

-- ============================================================
-- ontology_object_types: 加 active_version 字段 (v6.1 升级)
-- ============================================================
ALTER TABLE public.ontology_object_types
    ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'v1';

-- 多版本支持: 每个 ontology_object_types 现在可以有多个 versions
CREATE TABLE public.ontology_object_type_versions (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
    object_type_id         uuid NOT NULL REFERENCES public.ontology_object_types(id) ON DELETE CASCADE,
    version                 text NOT NULL,            -- 'v1', 'v2', etc.
    properties              jsonb NOT NULL DEFAULT '{}'::jsonb,
    link_types              text[] NOT NULL DEFAULT '{}',
    action_types            text[] NOT NULL DEFAULT '{}',
    changelog               text,                     -- v1→v2 改了什么
    created_at              timestamptz NOT NULL DEFAULT now(),
    deprecated_at           timestamptz,                -- 软删除标记
    UNIQUE (tenant_id, object_type_id, version)
);

CREATE INDEX ontology_versions_lookup_idx
    ON public.ontology_object_type_versions (tenant_id, object_type_id, version)
    WHERE deprecated_at IS NULL;

ALTER TABLE public.ontology_object_type_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ontology_object_type_versions IS 'v6.1 多版本 ontology. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_insert('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_update('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_delete('public.ontology_object_type_versions'::regclass);

-- CREATE TRIGGER tg_ontology_versions_inject_tenant
    --     BEFORE INSERT ON public.ontology_object_type_versions
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_ontology_versions_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.ontology_object_type_versions
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- ============================================================
-- schema_migrations: 跨租户 schema 迁移记录
-- ============================================================
CREATE TABLE public.schema_migrations (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
    from_version            text NOT NULL,
    to_version              text NOT NULL,
    object_type_id          uuid NOT NULL REFERENCES public.ontology_object_types(id),
    affected_rows           int NOT NULL DEFAULT 0,
    status                  text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolled_back')),
    started_at              timestamptz NOT NULL DEFAULT now(),
    completed_at            timestamptz,
    error                   text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schema_migrations_tenant_status_idx
    ON public.schema_migrations (tenant_id, status, started_at DESC);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.schema_migrations IS 'v6.1 schema 迁移审计. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.schema_migrations'::regclass);
SELECT public._policy_tenant_insert('public.schema_migrations'::regclass);
SELECT public._policy_tenant_update('public.schema_migrations'::regclass);

-- CREATE TRIGGER tg_schema_migrations_inject_tenant
    --     BEFORE INSERT ON public.schema_migrations
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- ============================================================
-- RPC: 切换 ontology 活跃版本
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_object_type_version(
    p_tenant_id uuid,
    p_object_type_id uuid,
    p_new_version text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_vers int;
BEGIN
    -- 校验版本存在
    SELECT 1 INTO v_vers
    FROM public.ontology_object_type_versions
    WHERE tenant_id = p_tenant_id
      AND object_type_id = p_object_type_id
      AND version = p_new_version
      AND deprecated_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'activate_object_type_version: version % not found or deprecated', p_new_version;
    END IF;

    -- 切换
    UPDATE public.ontology_object_types
    SET active_version = p_new_version
    WHERE id = p_object_type_id
      AND tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_object_type_version(uuid, uuid, text) TO anon, authenticated, service_role;

-- ============================================================
-- pg_cron: schema migration 监控
-- ============================================================
SELECT cron.unschedule('schema-migration-monitor') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'schema-migration-monitor'
);

SELECT cron.schedule(
    'schema-migration-monitor',
    '0 * * * *',  -- 每小时
    $$
    UPDATE public.schema_migrations
    SET status = 'failed', error = 'timeout (1h)', completed_at = now()
    WHERE status = 'running' AND started_at < now() - interval '1 hour';
    $$
);

-- === 20260820220000_create_compass_dashboards.sql ===
-- supabase/migrations/20260820220000_create_compass_dashboards.sql
-- PRD: docs/active/prd/mp-data-product.md (Compass v6.1)
-- Batch: MP-V6.1-COMPASS-01
-- v6.1 Compass: 仪表盘系统 (dsh dashboard-curator preset 配套)

-- ============================================================
-- dashboards 表: 仪表盘定义
-- ============================================================
CREATE TABLE public.dashboards (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    name                text NOT NULL,
    description         text,
    layout              jsonb NOT NULL DEFAULT '{
        "grid": {"cols": 12, "rowHeight": 50},
        "widgets": []
    }'::jsonb,
    shared_with         text[] NOT NULL DEFAULT '{}',     -- user_ids / 'org' / 'public'
    created_by          uuid REFERENCES auth.users(id),
    updated_by          uuid REFERENCES auth.users(id),
    refresh_interval    text DEFAULT 'manual',            -- 'manual' | '5m' | '1h' | '1d'
    last_refreshed_at   timestamptz,
    tags                text[] NOT NULL DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboards_tenant_idx ON public.dashboards (tenant_id, created_at DESC);
CREATE INDEX dashboards_tags_idx ON public.dashboards USING gin (tags) WHERE array_length(tags, 1) > 0;

ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.dashboards IS 'v6.1 Compass: 业务仪表盘定义. layout.grid + layout.widgets. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.dashboards'::regclass);
SELECT public._policy_tenant_insert('public.dashboards'::regclass);
SELECT public._policy_tenant_update('public.dashboards'::regclass);
SELECT public._policy_tenant_delete('public.dashboards'::regclass);

-- CREATE TRIGGER tg_dashboards_inject_tenant
    --     BEFORE INSERT ON public.dashboards
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- CREATE TRIGGER tg_dashboards_audit
    --     AFTER INSERT OR UPDATE OR DELETE ON public.dashboards
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
    -- 
-- ============================================================
-- dashboard_widgets 表: 仪表盘内的 widget (chart / kpi / table)
-- ============================================================
CREATE TABLE public.dashboard_widgets (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id        uuid NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    type                text NOT NULL CHECK (type IN ('chart', 'kpi', 'table', 'text', 'sql')),
    title               text NOT NULL,
    sql_query           text,                              -- 业务 SQL (RLS 自动)
    chart_type          text CHECK (chart_type IN ('bar', 'line', 'pie', 'scatter', 'area', 'heatmap', 'number')),
    config              jsonb NOT NULL DEFAULT '{}'::jsonb,    -- chart config (colors, axes, etc.)
    grid_pos            jsonb NOT NULL DEFAULT '{"x":0,"y":0,"w":6,"h":4}'::jsonb,
    refresh_interval    text DEFAULT 'inherit',
    last_refreshed_at   timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_widgets_dashboard_idx ON public.dashboard_widgets (dashboard_id);
CREATE INDEX dashboard_widgets_tenant_idx ON public.dashboard_widgets (tenant_id);

ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.dashboard_widgets IS 'v6.1 Compass: dashboard 内 widget. type=chart/kpi/table/text/sql.';

SELECT public._policy_tenant_select('public.dashboard_widgets'::regclass);
SELECT public._policy_tenant_insert('public.dashboard_widgets'::regclass);
SELECT public._policy_tenant_update('public.dashboard_widgets'::regclass);
SELECT public._policy_tenant_delete('public.dashboard_widgets'::regclass);

-- CREATE TRIGGER tg_dashboard_widgets_inject_tenant
    --     BEFORE INSERT ON public.dashboard_widgets
    --     FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();
    -- 
-- ============================================================
-- Materialized View: 订单 KPI 聚合 (常用 Compass 仪表盘)
-- ============================================================
CREATE MATERIALIZED VIEW public.mv_order_kpi_daily AS
SELECT
    tenant_id,
    DATE_TRUNC('day', created_at) AS day,
    COUNT(*) AS order_count,
    SUM(amount) AS total_amount,
    AVG(amount) AS avg_amount,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending_count
FROM public.orders
WHERE deleted_at IS NULL
GROUP BY tenant_id, DATE_TRUNC('day', created_at);

CREATE UNIQUE INDEX mv_order_kpi_daily_pk ON public.mv_order_kpi_daily (tenant_id, day);

ALTER TABLE public.mv_order_kpi_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON MATERIALIZED VIEW public.mv_order_kpi_daily IS 'v6.1 Compass MV: 每日订单 KPI 聚合. RLS: tenant 隔离.';

CREATE POLICY mv_order_kpi_daily_tenant_select ON public.mv_order_kpi_daily
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- pg_cron: 每日刷新 Materialized View
-- ============================================================
SELECT cron.unschedule('compass-mv-refresh') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compass-mv-refresh'
);

SELECT cron.schedule(
    'compass-mv-refresh',
    '0 1 * * *',  -- 每天凌晨 1 点
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_order_kpi_daily;
    $$
);

-- === 20260820300000_create_mp_preset_registry.sql ===
-- supabase/migrations/20260820300000_create_mp_preset_registry.sql
-- Loop 1/5 of MP-V6.1-APP-CENTER-01
-- PRD: docs/active/prd/mp-skill-marketplace.md
-- v6.1 App Center: 3 tables (presets + versions + installs) + RLS + pg_cron cleanup

-- ============================================================
-- Schema: mp_preset_registry
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mp_preset_registry;
COMMENT ON SCHEMA mp_preset_registry IS 'v6.1 App Center: digital employee preset registry (mp-skill-marketplace).';

-- ============================================================
-- presets: catalog (1 per preset family, shared across tenants if public)
-- ============================================================
CREATE TABLE mp_preset_registry.presets (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           uuid,                          -- NULL = public (cross-tenant), NOT NULL = private (per-tenant)
    name                text NOT NULL,
    slug                text NOT NULL,
    category            text NOT NULL,                -- 'support' | 'knowledge' | 'ontology' | 'review' | 'data' | 'contract' | 'workflow' | 'dashboard' | 'custom'
    description         text,
    icon                text,
    visibility         text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
    maintainer_id       uuid REFERENCES auth.users(id),
    tags                text[] NOT NULL DEFAULT '{}',
    downloads_count     int NOT NULL DEFAULT 0,
    rating_sum         int NOT NULL DEFAULT 0,
    rating_count       int NOT NULL DEFAULT 0,
    current_version     text,                          -- pointer to versions (lazy)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug),
    CHECK (visibility = 'public' OR tenant_id IS NOT NULL)
);

CREATE INDEX presets_tenant_idx ON mp_preset_registry.presets (tenant_id, category);
CREATE INDEX presets_visibility_idx ON mp_preset_registry.presets (visibility, category, created_at DESC);
CREATE INDEX presets_tags_idx ON mp_preset_registry.presets USING gin (tags) WHERE array_length(tags, 1) > 0;
CREATE INDEX presets_rating_idx ON mp_preset_registry.presets (rating_sum, rating_count) WHERE rating_count > 0;

ALTER TABLE mp_preset_registry.presets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE mp_preset_registry.presets IS 'v6.1 App Center: digital employee preset catalog.';

-- RLS: public presets visible to all, private only to owning tenant
CREATE POLICY presets_public_select ON mp_preset_registry.presets
    FOR SELECT TO anon, authenticated
    USING (visibility = 'public' OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY presets_tenant_insert ON mp_preset_registry.presets
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid OR visibility = 'public');

CREATE POLICY presets_tenant_update ON mp_preset_registry.presets
    FOR UPDATE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY presets_tenant_delete ON mp_preset_registry.presets
    FOR DELETE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- versions: semver per preset (1:N)
-- ============================================================
-- CREATE TABLE mp_preset_registry.versions (
--     id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--     preset_id           uuid NOT NULL REFERENCES mp_preset_registry.presets(id) ON DELETE CASCADE,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    version             text NOT NULL,                -- semver e.g. '1.2.3'
    manifest            jsonb NOT NULL,                -- dsh 0.1.0-rc.7 agent.cordis.yml structure
    files               jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{name, url, sha256, size}, ...]
    signature           text,                          -- GPG/cosign signature of (manifest + files)
    changelog           text,
    manifest_size       int NOT NULL,
    downloads_count     int NOT NULL DEFAULT 0,
    released_at         timestamptz NOT NULL DEFAULT now(),
    deprecated_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (preset_id, version)
);

-- CREATE INDEX versions_preset_idx ON mp_preset_registry.versions (preset_id, released_at DESC);
-- CREATE INDEX versions_deprecated_idx ON mp_preset_registry.versions (preset_id) WHERE deprecated_at IS NULL;
-- CREATE INDEX versions_released_idx ON mp_preset_registry.versions (released_at DESC);

-- ALTER TABLE mp_preset_registry.versions ENABLE ROW LEVEL SECURITY;
-- COMMENT ON TABLE mp_preset_registry.versions IS 'v6.1 App Center: semver versions per preset. Soft-delete via deprecated_at.';
-- 
-- RLS: presets visibility cascades to versions
-- CREATE POLICY versions_public_select ON mp_preset_registry.versions
--     FOR SELECT TO anon, authenticated
--     USING (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id
                  AND (p.visibility = 'public' OR p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid))
    );

-- CREATE POLICY versions_tenant_write ON mp_preset_registry.versions
--     FOR ALL TO authenticated
--     USING (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id AND p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id AND p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    );

-- ============================================================
-- installs: per-tenant install of a version
-- ============================================================
-- CREATE TABLE mp_preset_registry.installs (
--     id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--     tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    preset_id           uuid NOT NULL REFERENCES mp_preset_registry.presets(id) ON DELETE CASCADE,
--     version_id          uuid NOT NULL REFERENCES mp_preset_registry.versions(id) ON DELETE CASCADE,
--     workspace_id        text,                          -- dsh workspace reference (mp-runtime / mp-agent-team / mp-skill-marketplace)
--     config_override     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-tenant custom config
    installed_by        uuid REFERENCES auth.users(id),
    installed_at        timestamptz NOT NULL DEFAULT now(),
    uninstalled_at      timestamptz,                  -- soft delete
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'uninstalled', 'failed', 'updating')),
    UNIQUE (tenant_id, preset_id, workspace_id)
);

-- CREATE INDEX installs_tenant_idx ON mp_preset_registry.installs (tenant_id, status);
-- CREATE INDEX installs_preset_idx ON mp_preset_registry.installs (preset_id) WHERE uninstalled_at IS NULL;
-- CREATE INDEX installs_workspace_idx ON mp_preset_registry.installs (tenant_id, workspace_id) WHERE status = 'active';

-- ALTER TABLE mp_preset_registry.installs ENABLE ROW LEVEL SECURITY;
-- COMMENT ON TABLE mp_preset_registry.installs IS 'v6.1 App Center: per-tenant install record. RLS by tenant_id.';
-- 
-- RLS: per tenant only
-- CREATE POLICY installs_tenant_select ON mp_preset_registry.installs
--     FOR SELECT TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CREATE POLICY installs_tenant_insert ON mp_preset_registry.installs
--     FOR INSERT TO authenticated
--     WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CREATE POLICY installs_tenant_update ON mp_preset_registry.installs
--     FOR UPDATE TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CREATE POLICY installs_tenant_delete ON mp_preset_registry.installs
--     FOR DELETE TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- audit_log triggers (preset publishing + install/uninstall)
-- ============================================================
-- CREATE TRIGGER tg_presets_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.presets
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- CREATE TRIGGER tg_versions_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.versions
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
-- 
-- CREATE TRIGGER tg_installs_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.installs
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();
-- 
-- ============================================================
-- RPC: install preset (atomic create install + update current_version)
-- ============================================================
CREATE OR REPLACE FUNCTION mp_preset_registry.install_preset(
    p_tenant_id uuid,
    p_preset_id uuid,
    p_version_id uuid,
    p_workspace_id text,
    p_config_override jsonb DEFAULT '{}'::jsonb
-- ) RETURNS mp_preset_registry.installs
-- LANGUAGE plpgsql
-- SECURITY DEFINER
SET search_path = mp_preset_registry, public, pg_temp
AS $$
DECLARE
--     v_install mp_preset_registry.installs%ROWTYPE;
-- BEGIN
--     -- Soft-delete existing install for same (preset, workspace) if any
--     UPDATE mp_preset_registry.installs
--     SET status = 'uninstalled',
--         uninstalled_at = now()
    WHERE tenant_id = p_tenant_id
      AND preset_id = p_preset_id
      AND workspace_id = p_workspace_id
      AND status = 'active';

    -- Insert new install
--     INSERT INTO mp_preset_registry.installs (
--         tenant_id, preset_id, version_id, workspace_id, config_override
--     ) VALUES (
        p_tenant_id, p_preset_id, p_version_id, p_workspace_id, p_config_override
    ) RETURNING * INTO v_install;

    -- Update preset's current_version pointer
    UPDATE mp_preset_registry.presets
--     SET current_version = (SELECT version FROM mp_preset_registry.versions WHERE id = p_version_id),
--         downloads_count = downloads_count + 1
--     WHERE id = p_preset_id;

    -- Audit
    INSERT INTO public.audit_log (tenant_id, action, schema_name, table_name, row_pk, new_values)
    VALUES (p_tenant_id, 'INSTALL', 'mp_preset_registry', 'installs', v_install.id::text,
            to_jsonb(row_to_json(v_install)));

    RETURN v_install;
END;
$$;

GRANT EXECUTE ON FUNCTION mp_preset_registry.install_preset TO anon, authenticated, service_role;

-- ============================================================
-- pg_cron: cleanup old deprecated versions (> 1 year)
-- ============================================================
SELECT cron.unschedule('app-center-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'app-center-cleanup'
);

SELECT cron.schedule(
    'app-center-cleanup',
    '0 4 * * 0',  -- weekly Sun 04:00
    $$
--     DELETE FROM mp_preset_registry.versions
--     WHERE deprecated_at < now() - interval '1 year';
--     $$
);

-- ============================================================
-- Seed: 9 MP-v6 master + sub-role presets (per 4w cycle)
-- ============================================================
INSERT INTO mp_preset_registry.presets (tenant_id, name, slug, category, description, visibility, tags, current_version)
VALUES
    (NULL, 'mp-v6 master', 'mp-v6-master', 'custom', 'MP-v6 数字员工 master preset (8 sub-roles via dsh subagent dispatch)', 'public', ARRAY['mp-v6', 'master', 'orchestrator'], NULL),
    (NULL, 'support-triage', 'support-triage', 'support', '工单分诊 + HITL 升级 (high/urgent)', 'public', ARRAY['support', 'tickets', 'hitl'], NULL),
    (NULL, 'knowledge-curator', 'knowledge-curator', 'knowledge', '4 支柱架构 + 9 namespace + 19 apps + 8 CI gate 知识库', 'public', ARRAY['knowledge', 'architecture', 'rfc'], NULL),
    (NULL, 'ontology-curator', 'ontology-curator', 'ontology', '12 Ontology Kernel 设计 + apply-ontology-change Edge Function', 'public', ARRAY['ontology', 'schema', 'object-type'], NULL),
    (NULL, 'code-reviewer', 'code-reviewer', 'review', 'PR + SAST + 8 CI gate 自动审查', 'public', ARRAY['review', 'sast', 'pr'], NULL),
    (NULL, 'data-analyst', 'data-analyst', 'data', 'Compass: NL 转 SQL + RLS 隔离查询 + 图表 + dashboard', 'public', ARRAY['data', 'sql', 'compass'], NULL),
    (NULL, 'contract-drafter', 'contract-drafter', 'contract', 'NDA / 服务协议 / 销售合同起草 + 48h HITL 法务审批', 'public', ARRAY['contract', 'legal', 'hitl'], NULL),
    (NULL, 'hitl-orchestrator', 'hitl-orchestrator', 'workflow', '4 HITL 类型 + 多级升级 (24h to 96h)', 'public', ARRAY['hitl', 'approval', 'workflow'], NULL),
    (NULL, 'dashboard-curator', 'dashboard-curator', 'dashboard', '业务问题转 dashboard + 洞察', 'public', ARRAY['dashboard', 'compass', 'insight'], NULL)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Insert initial v1.0.0 versions
-- INSERT INTO mp_preset_registry.versions (preset_id, tenant_id, version, manifest, manifest_size, changelog)
-- SELECT
--     p.id,
    COALESCE(p.tenant_id, (SELECT id FROM public.tenants LIMIT 1)),
    '1.0.0',
    jsonb_build_object('id', p.slug, 'name', p.name, 'description', p.description, 'tools', '[]'::jsonb),
    2048,
    'Initial v1.0.0 release'
FROM mp_preset_registry.presets p
WHERE p.tenant_id IS NULL
ON CONFLICT (preset_id, version) DO NOTHING;

-- Update current_version pointer
UPDATE mp_preset_registry.presets p
SET current_version = '1.0.0'
WHERE p.tenant_id IS NULL AND p.current_version IS NULL;


