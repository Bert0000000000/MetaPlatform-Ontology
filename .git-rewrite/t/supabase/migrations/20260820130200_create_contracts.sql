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

CREATE TRIGGER tg_contracts_inject_tenant
    BEFORE INSERT ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_contracts_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- 演示: HITL 落库 (待审批合同)
-- 业务触发 contract_approval_workflow (Temporal), 通过 HITL Hub 4 种类型联动
-- v6.0 详细流程见 application-architecture spec §3.4