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

CREATE TRIGGER tg_products_inject_tenant
    BEFORE INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_products_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();