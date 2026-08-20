-- supabase/migrations/20260820200000_create_saml_sso_tables.sql
-- PRD: docs/active/prd/auth-jwt-rls.md §6.1
-- Batch: MetaPlatform.1-SAML-SSO-01
-- v6.1 SAML SSO: per-tenant IdP config + assertion cache

-- ============================================================
-- tenant_sso_configs: 每租户 IdP metadata + claim mapping
-- ============================================================
CREATE TABLE public.tenant_sso_configs (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    enabled                 boolean NOT NULL DEFAULT true,
    provider                text NOT NULL CHECK (provider IN ('azure-ad', 'okta', 'auth0', 'google', 'okta-oidc', 'generic-saml')),
    entity_id               text NOT NULL,            -- SP entity ID (e.g. "https://mp-platform.example.com/saml")
    sso_url                  text NOT NULL,            -- SP-initiated SSO URL
    slo_url                  text,                    -- Single Logout URL (optional)
    idp_metadata_xml        text NOT NULL,            -- raw IdP metadata XML
    idp_entity_id           text NOT NULL,            -- IdP entity ID (extracted from XML)
    idp_sso_url              text NOT NULL,            -- IdP SSO endpoint (extracted)
    idp_certificate         text,                     -- IdP signing cert (PEM)
    claim_mappings          jsonb NOT NULL DEFAULT '{
        "email": "email",
        "role": "role",
        "tenant_id": "tenant_id"
    }'::jsonb,
    default_role            text NOT NULL DEFAULT 'member',
    enabled_at              timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX tenant_sso_configs_tenant_idx ON public.tenant_sso_configs (tenant_id) WHERE enabled = true;

ALTER TABLE public.tenant_sso_configs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_sso_configs IS 'v6.1 SAML SSO: per-tenant IdP metadata + claim mapping. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_insert('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_update('public.tenant_sso_configs'::regclass);
SELECT public._policy_tenant_delete('public.tenant_sso_configs'::regclass);

CREATE TRIGGER tg_tenant_sso_configs_inject_tenant
    BEFORE INSERT ON public.tenant_sso_configs
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_tenant_sso_configs_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.tenant_sso_configs
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- saml_assertions: SP 接收的 IdP assertion 缓存
-- ============================================================
CREATE TABLE public.saml_assertions (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    request_id              text NOT NULL,            -- SP-initiated RelayState (correlation)
    subject                 text NOT NULL,            -- NameID (user identifier)
    issuer                  text NOT NULL,            -- IdP entity ID
    attributes              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 所有 attribute 声明
    user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- 解析后关联的用户
    received_at             timestamptz NOT NULL DEFAULT now(),
    expires_at              timestamptz NOT NULL,
    processed               boolean NOT NULL DEFAULT false,
    processed_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saml_assertions_tenant_received_idx ON public.saml_assertions (tenant_id, received_at DESC);
CREATE INDEX saml_assertions_unprocessed_idx ON public.saml_assertions (tenant_id, processed) WHERE processed = false;
CREATE INDEX saml_assertions_expires_idx ON public.saml_assertions (expires_at) WHERE processed = false;

ALTER TABLE public.saml_assertions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.saml_assertions IS 'v6.1 SAML SSO: IdP assertion 缓存. processed=true 后清理. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.saml_assertions'::regclass);
SELECT public._policy_tenant_insert('public.saml_assertions'::regclass);
SELECT public._policy_tenant_update('public.saml_assertions'::regclass);
SELECT public._policy_tenant_delete('public.saml_assertions'::regclass);

CREATE TRIGGER tg_saml_assertions_inject_tenant
    BEFORE INSERT ON public.saml_assertions
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- ============================================================
-- pg_cron: 清理过期 assertion
-- ============================================================
SELECT cron.unschedule('saml-assertion-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'saml-assertion-cleanup'
);

SELECT cron.schedule(
    'saml-assertion-cleanup',
    '*/15 * * * *',
    $$
    DELETE FROM public.saml_assertions
    WHERE expires_at < now() AND processed = true;
    $$
);