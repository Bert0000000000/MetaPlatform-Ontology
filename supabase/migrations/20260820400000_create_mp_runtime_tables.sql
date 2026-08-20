-- supabase/migrations/20260820400000_create_mp_runtime_tables.sql
-- PRD: docs/active/prd/mp-runtime.md §4
-- Batch: MetaPlatform-MP-RUNTIME-01
-- mp-runtime schema: business runtime Edge Function registry + session tracking
-- Idempotent: safe to re-apply after supabase restart

CREATE SCHEMA IF NOT EXISTS mp_runtime;

-- Edge Function 元数据注册表 (per PRD §4)
CREATE TABLE IF NOT EXISTS mp_runtime.functions (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         text NOT NULL UNIQUE,
    version      text NOT NULL,
    handler      text NOT NULL,                       -- 'mp-orders/create-order'
    tenant_id    uuid REFERENCES public.tenants(id),  -- NULL = 全局 Edge Function
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mp_runtime_functions_tenant_idx ON mp_runtime.functions (tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE mp_runtime.functions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_mp_runtime_functions_tenant_select ON mp_runtime.functions;
CREATE POLICY rls_mp_runtime_functions_tenant_select ON mp_runtime.functions
    FOR SELECT TO authenticated
    USING (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS rls_mp_runtime_functions_tenant_insert ON mp_runtime.functions;
CREATE POLICY rls_mp_runtime_functions_tenant_insert ON mp_runtime.functions
    FOR INSERT TO authenticated
    WITH CHECK (
        (auth.jwt() ->> 'role') IN ('owner', 'admin')
        AND (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    );

DROP POLICY IF EXISTS rls_mp_runtime_functions_tenant_update ON mp_runtime.functions;
CREATE POLICY rls_mp_runtime_functions_tenant_update ON mp_runtime.functions
    FOR UPDATE TO authenticated
    USING (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

DROP POLICY IF EXISTS rls_mp_runtime_functions_tenant_delete ON mp_runtime.functions;
CREATE POLICY rls_mp_runtime_functions_tenant_delete ON mp_runtime.functions
    FOR DELETE TO authenticated
    USING (
        (auth.jwt() ->> 'role') IN ('owner', 'admin')
        AND (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    );

-- session tracking (runtime session lifecycle: trigger -> status -> cancel)
CREATE TABLE IF NOT EXISTS mp_runtime.sessions (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    user_id         uuid NOT NULL REFERENCES auth.users(id),
    function_name   text NOT NULL,
    input_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    result          jsonb,
    error_message   text,
    duration_ms     int,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mp_runtime_sessions_tenant_idx ON mp_runtime.sessions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS mp_runtime_sessions_status_idx ON mp_runtime.sessions (status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS mp_runtime_sessions_user_idx ON mp_runtime.sessions (user_id, started_at DESC);

ALTER TABLE mp_runtime.sessions ENABLE ROW LEVEL SECURITY;

-- Drop any old policies that may have been created with the qualified-name pattern
-- (the helper functions embed '.' in the policy name for schema-qualified regclass,
-- which can not be expressed as a bare DROP POLICY literal — must use dynamic SQL)
DO $body$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'mp_runtime' AND tablename = 'sessions'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON mp_runtime.sessions', pol.policyname);
    END LOOP;
END
$body$;

SELECT public._policy_tenant_select('mp_runtime.sessions'::regclass);
SELECT public._policy_tenant_insert('mp_runtime.sessions'::regclass);
SELECT public._policy_tenant_update('mp_runtime.sessions'::regclass);
SELECT public._policy_tenant_delete('mp_runtime.sessions'::regclass);

DROP TRIGGER IF EXISTS tg_mp_runtime_sessions_inject_tenant ON mp_runtime.sessions;
CREATE TRIGGER tg_mp_runtime_sessions_inject_tenant
    BEFORE INSERT ON mp_runtime.sessions
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- mp_runtime.functions supports global (tenant_id IS NULL) AND tenant-scoped rows.
-- tenant_id is set explicitly by the Edge Function (no auto-injection needed).

DROP TRIGGER IF EXISTS tg_mp_runtime_sessions_audit ON mp_runtime.sessions;
CREATE TRIGGER tg_mp_runtime_sessions_audit
    AFTER INSERT OR UPDATE OR DELETE ON mp_runtime.sessions
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- seed a sample global function for E2E (idempotent via ON CONFLICT)
INSERT INTO mp_runtime.functions (name, version, handler, tenant_id, config) VALUES
    ('mp-runtime-hello', '1.0.0', 'mp-runtime/hello', NULL, '{"description": "Hello world Edge Function"}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- grants: PostgREST exposes mp_runtime.* to authenticated + service_role
GRANT USAGE ON SCHEMA mp_runtime TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mp_runtime.sessions TO authenticated, service_role;
GRANT SELECT ON mp_runtime.functions TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON mp_runtime.functions TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mp_runtime TO authenticated, service_role;