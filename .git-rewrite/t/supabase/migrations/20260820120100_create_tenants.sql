-- supabase/migrations/20260820120100_create_tenants.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.1
-- 公共字段: id / tenant_id / created_at / updated_at (应用表必须遵守)

CREATE TABLE public.tenants (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug         text NOT NULL UNIQUE,
    name         text NOT NULL,
    status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended', 'archived')),
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz
);

CREATE INDEX tenants_status_idx ON public.tenants (status) WHERE status <> 'archived';

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- service_role 全权; anon / authenticated 见自己所属租户
COMMENT ON TABLE public.tenants IS 'v6.0 multi-tenant registry. RLS: service_role full; authenticated sees only own tenant_id.';

CREATE POLICY tenant_self_select ON public.tenants
    FOR SELECT TO authenticated
    USING (id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY tenant_self_update ON public.tenants
    FOR UPDATE TO authenticated
    USING (id = (auth.jwt() ->> 'tenant_id')::uuid)
    WITH CHECK (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- INSERT/DELETE 限定 service_role (在 service policy 中另设)