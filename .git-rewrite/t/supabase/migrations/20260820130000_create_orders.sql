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
CREATE TRIGGER tg_orders_inject_tenant
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- tg_audit 触发器 (写 audit_log)
CREATE TRIGGER tg_orders_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- 软删默认: UPDATE 不直接 DELETE, 业务代码 SET deleted_at = now()
-- 视图过滤已删记录
CREATE VIEW public.orders_active AS
    SELECT * FROM public.orders WHERE deleted_at IS NULL;