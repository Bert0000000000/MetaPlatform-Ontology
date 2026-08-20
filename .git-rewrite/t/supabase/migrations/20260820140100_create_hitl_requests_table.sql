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

CREATE TRIGGER tg_hitl_inject_tenant
    BEFORE INSERT ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_hitl_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();