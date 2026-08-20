-- supabase/migrations/20260820130100_create_customers.sql
-- 业务表模板 — customers (P1)

CREATE TABLE public.customers (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    external_id     text,                          -- v3.0 迁过来的客户 ID (MetaPlatform-MIGRATION-01)
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

CREATE TRIGGER tg_customers_inject_tenant
    BEFORE INSERT ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_customers_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- orders 现在可以引用 customers (FK 加在 orders migration 之后, 避免依赖循环)
ALTER TABLE public.orders
    ADD CONSTRAINT orders_customer_fk
    FOREIGN KEY (customer_id) REFERENCES public.customers(id);