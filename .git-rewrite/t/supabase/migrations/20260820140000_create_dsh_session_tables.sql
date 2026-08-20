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

CREATE TRIGGER tg_dsh_headers_inject_tenant
    BEFORE INSERT ON public.dsh_session_headers
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- events 表不需要 tg_audit (高频写入, 会拖慢)