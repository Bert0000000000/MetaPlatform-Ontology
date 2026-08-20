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

CREATE TRIGGER tg_invoices_inject_tenant
    BEFORE INSERT ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_invoices_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();