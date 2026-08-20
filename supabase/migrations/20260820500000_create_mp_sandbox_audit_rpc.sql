-- supabase/migrations/20260820500000_create_mp_sandbox_audit_rpc.sql
-- PRD: docs/active/prd/mp-sandbox.md
-- ADR:  docs/active/decisions/ADR-0069-mp-sandbox-poc.md
-- Issue: #16 (mp-sandbox production tracker)
--
-- PoC 阶段: mp-sandbox Edge Function 直接 INSERT audit_log 被 service_role
-- 拒绝 (audit_log 表没显式 GRANT). 给 mp-sandbox 专门开一个 SECURITY DEFINER
-- RPC, 用 mp_sandbox schema 隔离, 不污染其他业务表.
--
-- 生产路径 (Issue #16 后续):
--   - 创建 mp_sandbox.executions 表, 挂 tg_audit 触发器, 自动写 audit_log
--   - 删掉这个 RPC, 直接走表写入

-- ============================================================
-- Schema: mp_sandbox
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mp_sandbox;
COMMENT ON SCHEMA mp_sandbox IS 'v6.1 mp-sandbox: code execution sandbox (PoC: Edge Function mock, Issue #16: sidecar bwrap/Landlock).';

-- ============================================================
-- RPC: record execution audit event (SECURITY DEFINER for audit_log INSERT)
-- ============================================================
CREATE OR REPLACE FUNCTION mp_sandbox.record_execution(
    p_tenant_id    uuid,
    p_actor_id     uuid,
    p_action       text,         -- 'SANDBOX_EXECUTE' | 'SANDBOX_DENIED' | 'SANDBOX_TIMEOUT'
    p_language     text,
    p_code_sha256  text,
    p_code_bytes   int,
    p_timeout_ms   int,
    p_network      text,         -- 'isolated' | 'internet'
    p_exit_code    int,
    p_duration_ms  int,
    p_stdout_bytes int,
    p_stderr_bytes int,
    p_metadata     jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mp_sandbox, public, pg_temp
AS $$
DECLARE
    v_audit_id bigint;
BEGIN
    INSERT INTO public.audit_log (
        tenant_id, actor_id, action, schema_name, table_name,
        new_values, ip_addr
    ) VALUES (
        p_tenant_id, p_actor_id, p_action, 'mp_sandbox', 'executions',
        jsonb_build_object(
            'language', p_language,
            'code_sha256', p_code_sha256,
            'code_bytes', p_code_bytes,
            'timeout_ms', p_timeout_ms,
            'network', p_network,
            'exit_code', p_exit_code,
            'duration_ms', p_duration_ms,
            'stdout_bytes', p_stdout_bytes,
            'stderr_bytes', p_stderr_bytes
        ) || p_metadata,
        NULL
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mp_sandbox.record_execution TO anon, authenticated, service_role;

COMMENT ON FUNCTION mp_sandbox.record_execution IS
    'mp-sandbox PoC: write execution audit_log entry. SECURITY DEFINER for INSERT. Production: replace with mp_sandbox.executions table + tg_audit trigger (Issue #16).';

-- ============================================================
-- Public wrapper (PostgREST rpc/ endpoint 只能查 public schema)
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_execution(
    p_tenant_id    uuid,
    p_actor_id     uuid,
    p_action       text,
    p_language     text,
    p_code_sha256  text,
    p_code_bytes   int,
    p_timeout_ms   int,
    p_network      text,
    p_exit_code    int,
    p_duration_ms  int,
    p_stdout_bytes int,
    p_stderr_bytes int,
    p_metadata     jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mp_sandbox, public, pg_temp
AS $$
BEGIN
    RETURN mp_sandbox.record_execution(
        p_tenant_id, p_actor_id, p_action, p_language, p_code_sha256,
        p_code_bytes, p_timeout_ms, p_network, p_exit_code, p_duration_ms,
        p_stdout_bytes, p_stderr_bytes, p_metadata
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_execution TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.record_execution IS
    'Public wrapper for mp_sandbox.record_execution. PostgREST rpc/ endpoint only resolves public schema. Production: drop this wrapper after Issue #16 ships real table.';