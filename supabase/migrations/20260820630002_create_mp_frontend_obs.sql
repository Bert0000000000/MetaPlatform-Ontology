-- supabase/migrations/20260820630002_create_mp_frontend_obs.sql
-- PRD:  docs/active/specs/2026-08-19-mp-v6-application-architecture.md §9.4
-- ADR:   docs/active/decisions/ADR-0059-mp-observability.md (frontend extension)
-- Batch: MetaPlatform-EDGE-FN-01 (mp-frontend-obs)
--
-- 19 apps 之一: mp-frontend-obs (前端可观测性)
-- 接收前端埋点 (page_view / click / error / performance)
-- 服务: 写入 frontend_events 表 + Realtime 推送 (前端 dashboard 订阅)

CREATE TABLE IF NOT EXISTS public.frontend_events (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES auth.users(id),
    session_id      text NOT NULL,
    event_type      text NOT NULL CHECK (event_type IN ('page_view', 'click', 'error', 'performance')),
    page            text NOT NULL,
    data            jsonb NOT NULL DEFAULT '{}'::jsonb,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frontend_events_tenant_idx
    ON public.frontend_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS frontend_events_type_idx
    ON public.frontend_events (tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS frontend_events_session_idx
    ON public.frontend_events (tenant_id, session_id, created_at DESC);

ALTER TABLE public.frontend_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.frontend_events IS
    'v6.0 mp-frontend-obs: 前端埋点 (page_view/click/error/performance). RLS: tenant 隔离. 应用架构 §9.4.';

-- RLS
SELECT public._policy_tenant_select('public.frontend_events'::regclass);
SELECT public._policy_tenant_insert('public.frontend_events'::regclass);
SELECT public._policy_tenant_update('public.frontend_events'::regclass);
SELECT public._policy_tenant_delete('public.frontend_events'::regclass);

-- tg_audit
CREATE TRIGGER tg_frontend_events_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.frontend_events
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- Realtime: 推送给前端 dashboard
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.frontend_events;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 默认 'global' tenant (匿名事件入这里)
INSERT INTO public.tenants (slug, name) VALUES ('global', 'Global (anonymous frontend events)')
ON CONFLICT (slug) DO NOTHING;

-- View: per-tenant event type breakdown (mp-monitoring dashboard 数据源)
CREATE OR REPLACE VIEW public.frontend_events_summary AS
SELECT
    tenant_id,
    date_trunc('hour', created_at) AS hour,
    event_type,
    count(*)::int AS n,
    count(DISTINCT session_id)::int AS sessions
FROM public.frontend_events
GROUP BY tenant_id, date_trunc('hour', created_at), event_type;

GRANT SELECT ON public.frontend_events_summary TO anon, authenticated, service_role;

COMMENT ON VIEW public.frontend_events_summary IS
    'v6.0 mp-frontend-obs: per-tenant hourly event type 统计. 给 mp-monitoring dashboard.';