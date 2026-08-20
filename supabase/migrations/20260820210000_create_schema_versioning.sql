-- supabase/migrations/20260820210000_create_schema_versioning.sql
-- PRD: docs/active/prd/ontology-gen.md §4.4
-- Batch: MP-V6.1-SCHEMA-VERSION-01
-- v6.1 Schema Versioning: 多版本 ontology_object_types + 版本切换

-- ============================================================
-- ontology_object_types: 加 active_version 字段 (v6.1 升级)
-- ============================================================
ALTER TABLE public.ontology_object_types
    ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'v1';

-- 多版本支持: 每个 ontology_object_types 现在可以有多个 versions
CREATE TABLE public.ontology_object_type_versions (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
    object_type_id         uuid NOT NULL REFERENCES public.ontology_object_types(id) ON DELETE CASCADE,
    version                 text NOT NULL,            -- 'v1', 'v2', etc.
    properties              jsonb NOT NULL DEFAULT '{}'::jsonb,
    link_types              text[] NOT NULL DEFAULT '{}',
    action_types            text[] NOT NULL DEFAULT '{}',
    changelog               text,                     -- v1→v2 改了什么
    created_at              timestamptz NOT NULL DEFAULT now(),
    deprecated_at           timestamptz,                -- 软删除标记
    UNIQUE (tenant_id, object_type_id, version)
);

CREATE INDEX ontology_versions_lookup_idx
    ON public.ontology_object_type_versions (tenant_id, object_type_id, version)
    WHERE deprecated_at IS NULL;

ALTER TABLE public.ontology_object_type_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ontology_object_type_versions IS 'v6.1 多版本 ontology. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_insert('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_update('public.ontology_object_type_versions'::regclass);
SELECT public._policy_tenant_delete('public.ontology_object_type_versions'::regclass);

CREATE TRIGGER tg_ontology_versions_inject_tenant
    BEFORE INSERT ON public.ontology_object_type_versions
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_ontology_versions_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.ontology_object_type_versions
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- schema_migrations: 跨租户 schema 迁移记录
-- ============================================================
CREATE TABLE public.schema_migrations (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
    from_version            text NOT NULL,
    to_version              text NOT NULL,
    object_type_id          uuid NOT NULL REFERENCES public.ontology_object_types(id),
    affected_rows           int NOT NULL DEFAULT 0,
    status                  text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolled_back')),
    started_at              timestamptz NOT NULL DEFAULT now(),
    completed_at            timestamptz,
    error                   text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schema_migrations_tenant_status_idx
    ON public.schema_migrations (tenant_id, status, started_at DESC);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.schema_migrations IS 'v6.1 schema 迁移审计. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.schema_migrations'::regclass);
SELECT public._policy_tenant_insert('public.schema_migrations'::regclass);
SELECT public._policy_tenant_update('public.schema_migrations'::regclass);

CREATE TRIGGER tg_schema_migrations_inject_tenant
    BEFORE INSERT ON public.schema_migrations
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- ============================================================
-- RPC: 切换 ontology 活跃版本
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_object_type_version(
    p_tenant_id uuid,
    p_object_type_id uuid,
    p_new_version text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_vers int;
BEGIN
    -- 校验版本存在
    SELECT 1 INTO v_vers
    FROM public.ontology_object_type_versions
    WHERE tenant_id = p_tenant_id
      AND object_type_id = p_object_type_id
      AND version = p_new_version
      AND deprecated_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'activate_object_type_version: version % not found or deprecated', p_new_version;
    END IF;

    -- 切换
    UPDATE public.ontology_object_types
    SET active_version = p_new_version
    WHERE id = p_object_type_id
      AND tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_object_type_version(uuid, uuid, text) TO anon, authenticated, service_role;

-- ============================================================
-- pg_cron: schema migration 监控
-- ============================================================
SELECT cron.unschedule('schema-migration-monitor') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'schema-migration-monitor'
);

SELECT cron.schedule(
    'schema-migration-monitor',
    '0 * * * *',  -- 每小时
    $$
    UPDATE public.schema_migrations
    SET status = 'failed', error = 'timeout (1h)', completed_at = now()
    WHERE status = 'running' AND started_at < now() - interval '1 hour';
    $$
);