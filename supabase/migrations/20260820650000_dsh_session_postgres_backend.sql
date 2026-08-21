-- supabase/migrations/20260820650000_dsh_session_postgres_backend.sql
-- PRD:  docs/active/dsh-60-packages.md (M15 dsh session persistence Postgres backend)
-- ADR:   docs/active/decisions/ADR-0055-dsh-postgres-backend.md
-- Batch: MetaPlatform-DSH-POSTGRES-BACKEND-01 (Loop 1/3)
--
-- dsh 官方 JSONL / SQLite 后端不支持 K8s 多副本共享 session.
-- v6.0 自建 Postgres backend: 复用 Supabase PG, 多副本写同一 DB.
--
-- Schema (per ADR-0055):
--   - dsh_session_headers: session 元信息 (id, tenant_id, user_id, version, status, ...)
--   - dsh_session_events:   append-only event log (session_id, seq, type, time, data, source_event_seqs)
--
-- RLS: 全部 tenant 隔离 + service_role 完全访问
-- Realtime: 不需要 (事件通过 Polling 或 pg_notify 推送给 dsh-web)
-- Realtime WS 仅供前端 UI 用, 后端 polling 已够 (dsh session 1 秒级 sync)

-- ============================================================
-- Table: dsh_session_headers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dsh_session_headers (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES auth.users(id),
    workspace_id        uuid,                                       -- dsh workspace (per-tenant per-user)
    version             int NOT NULL DEFAULT 0,                      -- optimistic lock (per dsh convention)
    seed_length         int,
    origin              text,                                       -- cli / web / api / subagent
    delegation_depth    int NOT NULL DEFAULT 0,
    agent_preset        text,                                       -- preset slug (mp-v6-master / etc.)
    -- 业务扩展 (MP 自定义)
    title               text,
    status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'waiting_tool', 'waiting_hitl', 'waiting_external', 'completed', 'failed', 'cancelled')),
    pending_workflow_id  text,                                       -- Temporal workflow id (M40)
    pending_tool_call_id text,
    pending_tool_call_result jsonb,
    -- 时间戳
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    -- 元数据
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS dsh_session_headers_tenant_idx
    ON public.dsh_session_headers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dsh_session_headers_user_idx
    ON public.dsh_session_headers (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dsh_session_headers_status_idx
    ON public.dsh_session_headers (tenant_id, status, updated_at DESC)
    WHERE status IN ('running', 'waiting_tool', 'waiting_hitl', 'waiting_external');

ALTER TABLE public.dsh_session_headers ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.dsh_session_headers IS
    'v6.0 M15 dsh session Postgres backend: session 元数据. 替代 dsh JSONL/SQLite 单文件 backend, 支持 K8s 多副本. RLS: tenant 隔离. ADR-0055.';

-- RLS policies
SELECT public._policy_tenant_select('public.dsh_session_headers'::regclass);
SELECT public._policy_tenant_insert('public.dsh_session_headers'::regclass);
SELECT public._policy_tenant_update('public.dsh_session_headers'::regclass);
SELECT public._policy_tenant_delete('public.dsh_session_headers'::regclass);

-- tg_inject_tenant + tg_audit
CREATE TRIGGER tg_dsh_session_headers_inject_tenant
    BEFORE INSERT ON public.dsh_session_headers
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_dsh_session_headers_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.dsh_session_headers
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- updated_at 自动更新 (从 hitl 复用)
CREATE TRIGGER tg_dsh_session_headers_set_updated_at
    BEFORE UPDATE ON public.dsh_session_headers
    FOR EACH ROW EXECUTE FUNCTION public.tg_hitl_requests_set_updated_at();

-- ============================================================
-- Table: dsh_session_events (append-only event log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dsh_session_events (
    session_id          uuid NOT NULL REFERENCES public.dsh_session_headers(id) ON DELETE CASCADE,
    seq                 int NOT NULL,
    type                text NOT NULL,                              -- user / assistant / tool_use / tool_result / system / ...
    time                timestamptz NOT NULL DEFAULT now(),
    data                jsonb NOT NULL DEFAULT '{}'::jsonb,         -- event payload
    source_event_seqs   int[] NOT NULL DEFAULT '{}',                -- parent events (event sourcing)
    surface_op          text,                                       -- 'append' / 'rewrite' / 'compact' (per dsh session-projection)
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS dsh_session_events_time_idx
    ON public.dsh_session_events (session_id, time);
CREATE INDEX IF NOT EXISTS dsh_session_events_type_idx
    ON public.dsh_session_events (session_id, type, time);

-- 注: 不加 RLS (events 跟随 header 权限). header 不可见 → events 也不可见 (应用层校验)
-- Realtime: 不加 (高吞吐, dsh session 投影走 polling + seq ordering)

COMMENT ON TABLE public.dsh_session_events IS
    'v6.0 M15: dsh session event log (append-only, event sourcing). 跟随 dsh_session_headers 的 tenant RLS (应用层校验).';

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dsh_session_headers TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.dsh_session_events TO anon, authenticated, service_role;

-- ============================================================
-- View: dsh_session_summary (per-tenant 数字, mp-monitoring dashboard)
-- ============================================================
CREATE OR REPLACE VIEW public.dsh_session_summary AS
SELECT
    tenant_id,
    count(*) FILTER (WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external'))::int AS active_count,
    count(*) FILTER (WHERE status = 'completed')::int AS completed_count,
    count(*) FILTER (WHERE status = 'failed')::int AS failed_count,
    max(updated_at) FILTER (WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external')) AS last_active_at
FROM public.dsh_session_headers
GROUP BY tenant_id;

GRANT SELECT ON public.dsh_session_summary TO anon, authenticated, service_role;

COMMENT ON VIEW public.dsh_session_summary IS
    'v6.0 M15: per-tenant dsh session 状态统计. mp-monitoring / mp-platform dashboard.';

-- ============================================================
-- pg_cron: 每日 02:00 清理 completed/failed 超 30 天的 session (合规保留)
-- ============================================================
SELECT cron.unschedule('dsh-session-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'dsh-session-cleanup'
);

SELECT cron.schedule(
    'dsh-session-cleanup',
    '0 2 * * *',  -- 每日 02:00
    $$
    DELETE FROM public.dsh_session_headers
    WHERE status IN ('completed', 'failed', 'cancelled')
      AND completed_at < now() - interval '30 days'
    $$
);