-- supabase/migrations/20260820220000_create_compass_dashboards.sql
-- PRD: docs/active/prd/mp-data-product.md (Compass v6.1)
-- Batch: MetaPlatform.1-COMPASS-01
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

CREATE TRIGGER tg_dashboards_inject_tenant
    BEFORE INSERT ON public.dashboards
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_dashboards_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.dashboards
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

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

CREATE TRIGGER tg_dashboard_widgets_inject_tenant
    BEFORE INSERT ON public.dashboard_widgets
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

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