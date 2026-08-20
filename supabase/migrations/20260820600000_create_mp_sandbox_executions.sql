-- supabase/migrations/20260820600000_create_mp_sandbox_executions.sql
-- PRD:  docs/active/prd/mp-sandbox.md
-- ADR:   docs/active/decisions/ADR-0069-mp-sandbox-poc.md
-- Issue: #15 (mp-sandbox production path §3 — PoC → 生产切换 第 1 步)
--
-- 这一步 (Loop 1/3 of issue #15 §3):
--   1. 创建 mp_sandbox.executions 表 (structured record: code + result + mode)
--   2. RLS: tenant 隔离
--   3. tg_inject_tenant + tg_audit 触发器
--   4. EF 切换: 直接 INSERT mp_sandbox.executions (代替 RPC 写 audit_log 的唯一入口)
--   5. public.record_execution RPC 暂保留 (语义 audit_log SANDBOX_* action) — 下个 loop 删
--
-- 后续 loops (issue #15 §3):
--   - Loop 2/3: 删 public.record_execution + public wrapper, 全部走 mp_sandbox.executions
--   - Loop 3/3: sidecar HTTP 接入, EF 读 mp_sandbox.executions 状态

-- ============================================================
-- Table: mp_sandbox.executions
-- ============================================================
CREATE TABLE IF NOT EXISTS mp_sandbox.executions (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    actor_id        uuid REFERENCES auth.users(id),
    action          text NOT NULL CHECK (action IN ('SANDBOX_EXECUTE', 'SANDBOX_DENIED', 'SANDBOX_TIMEOUT')),
    language        text NOT NULL CHECK (language IN ('python', 'javascript', 'bash')),
    code_sha256     text NOT NULL,
    code_bytes      int  NOT NULL CHECK (code_bytes >= 0),
    timeout_ms      int  NOT NULL CHECK (timeout_ms > 0),
    network         text NOT NULL DEFAULT 'isolated' CHECK (network IN ('isolated', 'internet')),
    exit_code       int,
    duration_ms     int,
    stdout_bytes    int NOT NULL DEFAULT 0 CHECK (stdout_bytes >= 0),
    stderr_bytes    int NOT NULL DEFAULT 0 CHECK (stderr_bytes >= 0),
    mode            text NOT NULL DEFAULT 'poc_mock' CHECK (mode IN ('poc_mock', 'sidecar_sync', 'k8s_job_async')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_sandbox_executions_tenant_idx
    ON mp_sandbox.executions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_sandbox_executions_action_idx
    ON mp_sandbox.executions (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_sandbox_executions_actor_idx
    ON mp_sandbox.executions (actor_id, created_at DESC);

ALTER TABLE mp_sandbox.executions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE mp_sandbox.executions IS
    'v6.0 mp-sandbox: structured execution record. mode: poc_mock (PoC) | sidecar_sync (production <30s) | k8s_job_async (production >30s). RLS: tenant 隔离. Issue #15.';

-- RLS policies
SELECT public._policy_tenant_select('mp_sandbox.executions'::regclass);
SELECT public._policy_tenant_insert('mp_sandbox.executions'::regclass);
SELECT public._policy_tenant_update('mp_sandbox.executions'::regclass);
SELECT public._policy_tenant_delete('mp_sandbox.executions'::regclass);

-- Triggers
CREATE TRIGGER tg_mp_sandbox_executions_inject_tenant
    BEFORE INSERT ON mp_sandbox.executions
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_mp_sandbox_executions_audit
    AFTER INSERT OR UPDATE OR DELETE ON mp_sandbox.executions
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- Grants (EF 用 service_role 写入; anon/authenticated 用 RLS 读)
-- ============================================================
GRANT USAGE ON SCHEMA mp_sandbox TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON mp_sandbox.executions TO anon, authenticated, service_role;

-- ============================================================
-- View: per-tenant execution stats (mp-audit dashboard 数据源)
-- ============================================================
CREATE OR REPLACE VIEW mp_sandbox.execution_stats AS
SELECT
    tenant_id,
    date_trunc('hour', created_at) AS hour,
    count(*) FILTER (WHERE action = 'SANDBOX_EXECUTE') AS execute_count,
    count(*) FILTER (WHERE action = 'SANDBOX_DENIED')  AS denied_count,
    count(*) FILTER (WHERE action = 'SANDBOX_TIMEOUT') AS timeout_count,
    avg(duration_ms) FILTER (WHERE action = 'SANDBOX_EXECUTE')::int AS avg_duration_ms,
    max(code_bytes) AS max_code_bytes
FROM mp_sandbox.executions
GROUP BY tenant_id, date_trunc('hour', created_at);

GRANT SELECT ON mp_sandbox.execution_stats TO anon, authenticated, service_role;

COMMENT ON VIEW mp_sandbox.execution_stats IS
    'v6.0 mp-sandbox: per-tenant hourly execution stats. Powers mp-audit dashboard.';