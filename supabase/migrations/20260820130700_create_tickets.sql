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

CREATE TRIGGER tg_tickets_inject_tenant
    BEFORE INSERT ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_tickets_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();