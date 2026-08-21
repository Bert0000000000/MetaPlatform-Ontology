-- supabase/migrations/20260820300000_create_mp_preset_registry.sql
-- Loop 1/5 of MetaPlatform.1-APP-CENTER-01
-- PRD: docs/active/prd/mp-skill-marketplace.md
-- v6.1 App Center: 3 tables (presets + versions + installs) + RLS + pg_cron cleanup

-- ============================================================
-- Schema: mp_preset_registry
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mp_preset_registry;
COMMENT ON SCHEMA mp_preset_registry IS 'v6.1 App Center: digital employee preset registry (mp-skill-marketplace).';

-- ============================================================
-- presets: catalog (1 per preset family, shared across tenants if public)
-- ============================================================
CREATE TABLE mp_preset_registry.presets (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           uuid,                          -- NULL = public (cross-tenant), NOT NULL = private (per-tenant)
    name                text NOT NULL,
    slug                text NOT NULL,
    category            text NOT NULL,                -- 'support' | 'knowledge' | 'ontology' | 'review' | 'data' | 'contract' | 'workflow' | 'dashboard' | 'custom'
    description         text,
    icon                text,
    visibility         text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
    maintainer_id       uuid REFERENCES auth.users(id),
    tags                text[] NOT NULL DEFAULT '{}',
    downloads_count     int NOT NULL DEFAULT 0,
    rating_sum         int NOT NULL DEFAULT 0,
    rating_count       int NOT NULL DEFAULT 0,
    current_version     text,                          -- pointer to versions (lazy)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug),
    CHECK (visibility = 'public' OR tenant_id IS NOT NULL)
);

CREATE INDEX presets_tenant_idx ON mp_preset_registry.presets (tenant_id, category);
CREATE INDEX presets_visibility_idx ON mp_preset_registry.presets (visibility, category, created_at DESC);
CREATE INDEX presets_tags_idx ON mp_preset_registry.presets USING gin (tags) WHERE array_length(tags, 1) > 0;
CREATE INDEX presets_rating_idx ON mp_preset_registry.presets (rating_sum, rating_count) WHERE rating_count > 0;

ALTER TABLE mp_preset_registry.presets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE mp_preset_registry.presets IS 'v6.1 App Center: digital employee preset catalog.';

-- RLS: public presets visible to all, private only to owning tenant
CREATE POLICY presets_public_select ON mp_preset_registry.presets
    FOR SELECT TO anon, authenticated
    USING (visibility = 'public' OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY presets_tenant_insert ON mp_preset_registry.presets
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid OR visibility = 'public');

CREATE POLICY presets_tenant_update ON mp_preset_registry.presets
    FOR UPDATE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY presets_tenant_delete ON mp_preset_registry.presets
    FOR DELETE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- versions: semver per preset (1:N)
-- ============================================================
CREATE TABLE mp_preset_registry.versions (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    preset_id           uuid NOT NULL REFERENCES mp_preset_registry.presets(id) ON DELETE CASCADE,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    version             text NOT NULL,                -- semver e.g. '1.2.3'
    manifest            jsonb NOT NULL,                -- dsh 0.1.0-rc.7 agent.cordis.yml structure
    files               jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{name, url, sha256, size}, ...]
    signature           text,                          -- GPG/cosign signature of (manifest + files)
    changelog           text,
    manifest_size       int NOT NULL,
    downloads_count     int NOT NULL DEFAULT 0,
    released_at         timestamptz NOT NULL DEFAULT now(),
    deprecated_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (preset_id, version)
);

CREATE INDEX versions_preset_idx ON mp_preset_registry.versions (preset_id, released_at DESC);
CREATE INDEX versions_deprecated_idx ON mp_preset_registry.versions (preset_id) WHERE deprecated_at IS NULL;
CREATE INDEX versions_released_idx ON mp_preset_registry.versions (released_at DESC);

ALTER TABLE mp_preset_registry.versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE mp_preset_registry.versions IS 'v6.1 App Center: semver versions per preset. Soft-delete via deprecated_at.';

-- RLS: presets visibility cascades to versions
CREATE POLICY versions_public_select ON mp_preset_registry.versions
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id
                  AND (p.visibility = 'public' OR p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid))
    );

CREATE POLICY versions_tenant_write ON mp_preset_registry.versions
    FOR ALL TO authenticated
    USING (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id AND p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM mp_preset_registry.presets p
                WHERE p.id = versions.preset_id AND p.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    );

-- ============================================================
-- installs: per-tenant install of a version
-- ============================================================
CREATE TABLE mp_preset_registry.installs (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    preset_id           uuid NOT NULL REFERENCES mp_preset_registry.presets(id) ON DELETE CASCADE,
    version_id          uuid NOT NULL REFERENCES mp_preset_registry.versions(id) ON DELETE CASCADE,
    workspace_id        text,                          -- dsh workspace reference (mp-runtime / mp-agent-team / mp-skill-marketplace)
    config_override     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-tenant custom config
    installed_by        uuid REFERENCES auth.users(id),
    installed_at        timestamptz NOT NULL DEFAULT now(),
    uninstalled_at      timestamptz,                  -- soft delete
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'uninstalled', 'failed', 'updating')),
    UNIQUE (tenant_id, preset_id, workspace_id)
);

CREATE INDEX installs_tenant_idx ON mp_preset_registry.installs (tenant_id, status);
CREATE INDEX installs_preset_idx ON mp_preset_registry.installs (preset_id) WHERE uninstalled_at IS NULL;
CREATE INDEX installs_workspace_idx ON mp_preset_registry.installs (tenant_id, workspace_id) WHERE status = 'active';

ALTER TABLE mp_preset_registry.installs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE mp_preset_registry.installs IS 'v6.1 App Center: per-tenant install record. RLS by tenant_id.';

-- RLS: per tenant only
CREATE POLICY installs_tenant_select ON mp_preset_registry.installs
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY installs_tenant_insert ON mp_preset_registry.installs
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY installs_tenant_update ON mp_preset_registry.installs
    FOR UPDATE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY installs_tenant_delete ON mp_preset_registry.installs
    FOR DELETE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- audit_log triggers (preset publishing + install/uninstall)
-- ============================================================
-- CREATE TRIGGER tg_presets_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.presets
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- CREATE TRIGGER tg_versions_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.versions
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- CREATE TRIGGER tg_installs_audit
--     AFTER INSERT OR UPDATE OR DELETE ON mp_preset_registry.installs
--     FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- RPC: install preset (atomic create install + update current_version)
-- ============================================================
CREATE OR REPLACE FUNCTION mp_preset_registry.install_preset(
    p_tenant_id uuid,
    p_preset_id uuid,
    p_version_id uuid,
    p_workspace_id text,
    p_config_override jsonb DEFAULT '{}'::jsonb
) RETURNS mp_preset_registry.installs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mp_preset_registry, public, pg_temp
AS $$
DECLARE
    v_install mp_preset_registry.installs%ROWTYPE;
BEGIN
    -- Soft-delete existing install for same (preset, workspace) if any
    UPDATE mp_preset_registry.installs
    SET status = 'uninstalled',
        uninstalled_at = now()
    WHERE tenant_id = p_tenant_id
      AND preset_id = p_preset_id
      AND workspace_id = p_workspace_id
      AND status = 'active';

    -- Insert new install
    INSERT INTO mp_preset_registry.installs (
        tenant_id, preset_id, version_id, workspace_id, config_override
    ) VALUES (
        p_tenant_id, p_preset_id, p_version_id, p_workspace_id, p_config_override
    ) RETURNING * INTO v_install;

    -- Update preset's current_version pointer
    UPDATE mp_preset_registry.presets
    SET current_version = (SELECT version FROM mp_preset_registry.versions WHERE id = p_version_id),
        downloads_count = downloads_count + 1
    WHERE id = p_preset_id;

    -- Audit
    INSERT INTO public.audit_log (tenant_id, action, schema_name, table_name, row_pk, new_values)
    VALUES (p_tenant_id, 'INSTALL', 'mp_preset_registry', 'installs', v_install.id::text,
            to_jsonb(row_to_json(v_install)));

    RETURN v_install;
END;
$$;

GRANT EXECUTE ON FUNCTION mp_preset_registry.install_preset TO anon, authenticated, service_role;

-- ============================================================
-- pg_cron: cleanup old deprecated versions (> 1 year)
-- ============================================================
SELECT cron.unschedule('app-center-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'app-center-cleanup'
);

SELECT cron.schedule(
    'app-center-cleanup',
    '0 4 * * 0',  -- weekly Sun 04:00
    $$
    DELETE FROM mp_preset_registry.versions
    WHERE deprecated_at < now() - interval '1 year';
    $$
);

-- ============================================================
-- Seed: 9 MetaPlatform master + sub-role presets (per 4w cycle)
-- ============================================================
INSERT INTO mp_preset_registry.presets (tenant_id, name, slug, category, description, visibility, tags, current_version)
VALUES
    (NULL, 'mp-v6 master', 'mp-v6-master', 'custom', 'MetaPlatform 数字员工 master preset (8 sub-roles via dsh subagent dispatch)', 'public', ARRAY['mp-v6', 'master', 'orchestrator'], NULL),
    (NULL, 'support-triage', 'support-triage', 'support', '工单分诊 + HITL 升级 (high/urgent)', 'public', ARRAY['support', 'tickets', 'hitl'], NULL),
    (NULL, 'knowledge-curator', 'knowledge-curator', 'knowledge', '4 支柱架构 + 9 namespace + 19 apps + 8 CI gate 知识库', 'public', ARRAY['knowledge', 'architecture', 'rfc'], NULL),
    (NULL, 'ontology-curator', 'ontology-curator', 'ontology', '12 Ontology Kernel 设计 + apply-ontology-change Edge Function', 'public', ARRAY['ontology', 'schema', 'object-type'], NULL),
    (NULL, 'code-reviewer', 'code-reviewer', 'review', 'PR + SAST + 8 CI gate 自动审查', 'public', ARRAY['review', 'sast', 'pr'], NULL),
    (NULL, 'data-analyst', 'data-analyst', 'data', 'Compass: NL 转 SQL + RLS 隔离查询 + 图表 + dashboard', 'public', ARRAY['data', 'sql', 'compass'], NULL),
    (NULL, 'contract-drafter', 'contract-drafter', 'contract', 'NDA / 服务协议 / 销售合同起草 + 48h HITL 法务审批', 'public', ARRAY['contract', 'legal', 'hitl'], NULL),
    (NULL, 'hitl-orchestrator', 'hitl-orchestrator', 'workflow', '4 HITL 类型 + 多级升级 (24h to 96h)', 'public', ARRAY['hitl', 'approval', 'workflow'], NULL),
    (NULL, 'dashboard-curator', 'dashboard-curator', 'dashboard', '业务问题转 dashboard + 洞察', 'public', ARRAY['dashboard', 'compass', 'insight'], NULL)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Insert initial v1.0.0 versions
INSERT INTO mp_preset_registry.versions (preset_id, tenant_id, version, manifest, manifest_size, changelog)
SELECT
    p.id,
    COALESCE(p.tenant_id, (SELECT id FROM public.tenants LIMIT 1)),
    '1.0.0',
    jsonb_build_object('id', p.slug, 'name', p.name, 'description', p.description, 'tools', '[]'::jsonb),
    2048,
    'Initial v1.0.0 release'
FROM mp_preset_registry.presets p
WHERE p.tenant_id IS NULL
ON CONFLICT (preset_id, version) DO NOTHING;

-- Update current_version pointer
UPDATE mp_preset_registry.presets p
SET current_version = '1.0.0'
WHERE p.tenant_id IS NULL AND p.current_version IS NULL;
