-- supabase/migrations/20260820120200_create_profiles.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.2
-- profiles 1:1 绑定 Supabase Auth (auth.users.id); 含公共字段

CREATE TABLE public.profiles (
    id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id     uuid NOT NULL REFERENCES public.tenants(id),
    email         text NOT NULL,
    display_name  text,
    role          text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX profiles_tenant_idx ON public.profiles (tenant_id);
CREATE INDEX profiles_role_idx  ON public.profiles (tenant_id, role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.profiles IS 'User profile 1:1 with auth.users. RLS: tenant isolation by JWT.tenant_id.';

-- 标准 4 policy (SELECT/INSERT/UPDATE/DELETE) — 见 supabase/policies/templates.sql
CREATE POLICY profile_tenant_select ON public.profiles
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_insert ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY profile_tenant_delete ON public.profiles
    FOR DELETE TO authenticated
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (auth.jwt() ->> 'role') IN ('owner', 'admin')
    );