-- supabase/migrations/20260820130800_create_ontology_tables.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.15 (12 Ontology Kernel)
-- 12 Ontology Kernel 表 (v6.0 核心数据模型)

CREATE TABLE public.ontology_object_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    rid             text NOT NULL,                    -- Resource Identifier
    slug            text NOT NULL,
    version         text NOT NULL DEFAULT 'v1',
    properties      jsonb NOT NULL DEFAULT '{}'::jsonb,
    link_types      text[] NOT NULL DEFAULT '{}',
    action_types    text[] NOT NULL DEFAULT '{}',
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rid)
);

CREATE INDEX ontology_object_types_tenant_idx ON public.ontology_object_types (tenant_id, slug);

ALTER TABLE public.ontology_object_types ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ontology_object_types IS 'Ontology Kernel: 12 个 object_type 定义. 多租户 RLS + audit.';

SELECT public._policy_tenant_select('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_object_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_object_types'::regclass);

CREATE TRIGGER tg_ontology_object_types_inject_tenant
    BEFORE INSERT ON public.ontology_object_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_ontology_object_types_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.ontology_object_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ontology_action_types
CREATE TABLE public.ontology_action_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    rid             text NOT NULL,
    name            text NOT NULL,
    parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
    permission      text,
    workflow_name   text,                            -- Temporal workflow 名
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rid)
);

ALTER TABLE public.ontology_action_types ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ontology_action_types IS 'Ontology Kernel: action_type 定义 (含 Temporal workflow 绑定).';

SELECT public._policy_tenant_select('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_action_types'::regclass);

CREATE TRIGGER tg_ontology_action_types_inject_tenant
    BEFORE INSERT ON public.ontology_action_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- pending_object_changes (用户提的待审批本体变更)
CREATE TABLE public.pending_object_changes (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    object_type_rid text NOT NULL,
    change_type     text NOT NULL CHECK (change_type IN ('create', 'update', 'delete', 'rename')),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    diff            jsonb,                           -- 变更 diff
    title           text,
    description     text,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
    approver_user_ids uuid[] NOT NULL DEFAULT '{}',
    applied_at      timestamptz,
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pending_object_changes_tenant_status_idx ON public.pending_object_changes (tenant_id, status, created_at DESC);

ALTER TABLE public.pending_object_changes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pending_object_changes IS 'Ontology: 待审批本体变更. apply-ontology-change Edge Function 入口.';

SELECT public._policy_tenant_select('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_insert('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_update('public.pending_object_changes'::regclass);
SELECT public._policy_tenant_delete('public.pending_object_changes'::regclass);

CREATE TRIGGER tg_pending_object_changes_inject_tenant
    BEFORE INSERT ON public.pending_object_changes
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_pending_object_changes_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.pending_object_changes
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();