-- supabase/migrations/20260820620000_create_ontology_kernel.sql
-- PRD:  docs/active/prd/mp-ontology.md (12 Ontology Kernel — M11)
-- ADR:   docs/active/decisions/ADR-0056-ontology-generation.md
-- Batch: MetaPlatform-ONTOLOGY-GEN-01 (Loop 1/3)
--
-- 12 Ontology Kernel 数据模型 (per 模块规划 M11 + ADR-0056):
--   1. ontology_object_types:   业务实体 (Customer / Order / Product / ...)
--   2. ontology_relation_types: 实体间关系 (Customer-HAS-Order / Order-CONTAINS-LineItem)
--   3. ontology_action_types:   可执行动作 (customer.create / order.approve)
--
-- 每个 type 有:
--   - rid:    路由 ID (e.g. "customer", "order")
--   - slug:   短名 (URL-safe)
--   - version: 乐观锁 (默认 v1, schema versioning 集成 M82)
--   - properties: jsonb schema (字段定义 + 类型 + 必填)
--   - payload_schema: 完整 JSON Schema (供 dsh / validation 用)
--   - status: draft / active / deprecated
--
-- 链接 (per spec §3.1):
--   - ObjectType.link_types:    可链接到哪些 RelationType
--   - ObjectType.action_types:  可触发哪些 ActionType
--
-- RLS: 全部 tenant 隔离, service_role 完全访问
-- Realtime: ontology_* UPDATE → mp-frontend 实时显示 schema 变更

-- ============================================================
-- Table: ontology_object_types (实体类型)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ontology_object_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    rid             text NOT NULL,                              -- 路由 ID (e.g. "customer", "order")
    slug            text NOT NULL,                              -- URL-safe short name
    name            text NOT NULL,                              -- 显示名 (e.g. "客户")
    description     text,
    version         text NOT NULL DEFAULT 'v1',                 -- schema version (M82 versioning)
    properties      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- 字段定义 (e.g. {email: {type: string, required: true}})
    payload_schema  jsonb NOT NULL DEFAULT '{}'::jsonb,         -- 完整 JSON Schema (validation)
    link_types      text[] NOT NULL DEFAULT '{}',               --  可链接的 RelationType rid 列表
    action_types    text[] NOT NULL DEFAULT '{}',               --  可触发的 ActionType rid 列表
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'deprecated')),
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, rid, version)
);

CREATE INDEX IF NOT EXISTS ontology_object_types_tenant_idx
    ON public.ontology_object_types (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ontology_object_types_rid_idx
    ON public.ontology_object_types (tenant_id, rid);

ALTER TABLE public.ontology_object_types ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ontology_object_types IS
    'v6.0 M11 Ontology Kernel: 业务实体类型定义 (Customer / Order / Product / ...). RLS: tenant 隔离. version 字段对接 M82 schema versioning.';

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

-- ============================================================
-- Table: ontology_relation_types (关系类型)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ontology_relation_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    rid             text NOT NULL,                              -- "customer_has_order"
    name            text NOT NULL,                              -- "客户拥有订单"
    description     text,
    from_type       text NOT NULL,                              -- source ObjectType rid
    to_type         text NOT NULL,                              -- target ObjectType rid
    cardinality     text NOT NULL DEFAULT 'one_to_many'
                    CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_many')),
    properties      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- 关系上的属性 (e.g. amount, created_at)
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'deprecated')),
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, rid)
);

CREATE INDEX IF NOT EXISTS ontology_relation_types_tenant_idx
    ON public.ontology_relation_types (tenant_id, status);
CREATE INDEX IF NOT EXISTS ontology_relation_types_from_to_idx
    ON public.ontology_relation_types (tenant_id, from_type, to_type);

ALTER TABLE public.ontology_relation_types ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ontology_relation_types IS
    'v6.0 M11 Ontology Kernel: 实体间关系 (Customer-HAS-Order). RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.ontology_relation_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_relation_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_relation_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_relation_types'::regclass);

CREATE TRIGGER tg_ontology_relation_types_inject_tenant
    BEFORE INSERT ON public.ontology_relation_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_ontology_relation_types_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.ontology_relation_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- Table: ontology_action_types (动作类型)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ontology_action_types (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    rid             text NOT NULL,                              -- "customer.create" / "order.approve"
    name            text NOT NULL,                              -- "创建客户"
    description     text,
    target_type     text NOT NULL,                              -- ObjectType rid (customer / order)
    parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- 参数 schema (e.g. {email, phone})
    permission      text NOT NULL DEFAULT 'member'              -- 'admin' / 'owner' / 'member'
                    CHECK (permission IN ('admin', 'owner', 'member', 'guest')),
    workflow_name   text,                                       -- Temporal workflow name (M40)
    hitl_type       text                                         -- 'workflow_saas' / 'workflow_dsh' / 'tool_dsh' / 'action_confirm'
                    CHECK (hitl_type IS NULL OR hitl_type IN ('workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm')),
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'deprecated')),
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, rid)
);

CREATE INDEX IF NOT EXISTS ontology_action_types_tenant_idx
    ON public.ontology_action_types (tenant_id, status);
CREATE INDEX IF NOT EXISTS ontology_action_types_target_idx
    ON public.ontology_action_types (tenant_id, target_type);

ALTER TABLE public.ontology_action_types ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ontology_action_types IS
    'v6.0 M11 Ontology Kernel + M12 ActionType: 可执行动作 (customer.create / order.approve). 关联 Temporal workflow + HITL type.';

SELECT public._policy_tenant_select('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_insert('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_update('public.ontology_action_types'::regclass);
SELECT public._policy_tenant_delete('public.ontology_action_types'::regclass);

CREATE TRIGGER tg_ontology_action_types_inject_tenant
    BEFORE INSERT ON public.ontology_action_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_ontology_action_types_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.ontology_action_types
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ontology_object_types TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ontology_relation_types TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ontology_action_types TO anon, authenticated, service_role;

-- ============================================================
-- Realtime: ontology_* → supabase_realtime publication
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ontology_object_types;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ontology_relation_types;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ontology_action_types;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================================
-- View: ontology_summary (per-tenant 统计, mp-monitoring dashboard)
-- ============================================================
CREATE OR REPLACE VIEW public.ontology_summary AS
SELECT
    t.id AS tenant_id,
    (SELECT count(*) FROM public.ontology_object_types  WHERE tenant_id = t.id AND status = 'active')::int AS object_types_count,
    (SELECT count(*) FROM public.ontology_relation_types WHERE tenant_id = t.id AND status = 'active')::int AS relation_types_count,
    (SELECT count(*) FROM public.ontology_action_types   WHERE tenant_id = t.id AND status = 'active')::int AS action_types_count
FROM public.tenants t;

GRANT SELECT ON public.ontology_summary TO anon, authenticated, service_role;

COMMENT ON VIEW public.ontology_summary IS
    'v6.0 M11: per-tenant ontology 3 类型活跃计数. mp-monitoring / mp-platform dashboard 数据源.';

-- ============================================================
-- Seed: 内置基础本体 (Customer / Order / Product / Contract)
-- ============================================================
INSERT INTO public.ontology_object_types (tenant_id, rid, slug, name, description, properties, status)
SELECT
    t.id,
    'customer',
    'customer',
    '客户',
    '客户实体 (v6.0 内置基础本体)',
    '{"email": {"type": "string", "required": true}, "phone": {"type": "string"}, "name": {"type": "string", "required": true}}'::jsonb,
    'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid, version) DO NOTHING;

INSERT INTO public.ontology_object_types (tenant_id, rid, slug, name, description, properties, status)
SELECT
    t.id,
    'order',
    'order',
    '订单',
    '订单实体 (v6.0 内置基础本体)',
    '{"amount": {"type": "number", "required": true}, "status": {"type": "string", "enum": ["draft", "pending_approval", "approved", "rejected", "fulfilled"]}}'::jsonb,
    'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid, version) DO NOTHING;

INSERT INTO public.ontology_object_types (tenant_id, rid, slug, name, description, properties, status)
SELECT
    t.id,
    'product',
    'product',
    '产品',
    '产品实体 (v6.0 内置基础本体)',
    '{"sku": {"type": "string", "required": true}, "name": {"type": "string", "required": true}, "price": {"type": "number"}}'::jsonb,
    'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid, version) DO NOTHING;

INSERT INTO public.ontology_object_types (tenant_id, rid, slug, name, description, properties, status)
SELECT
    t.id,
    'contract',
    'contract',
    '合同',
    '合同实体 (v6.0 内置基础本体)',
    '{"title": {"type": "string", "required": true}, "amount": {"type": "number"}, "status": {"type": "string", "enum": ["draft", "active", "archived"]}}'::jsonb,
    'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid, version) DO NOTHING;

INSERT INTO public.ontology_relation_types (tenant_id, rid, name, from_type, to_type, cardinality, status)
SELECT t.id, 'customer_has_orders', '客户拥有订单', 'customer', 'order', 'one_to_many', 'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid) DO NOTHING;

INSERT INTO public.ontology_relation_types (tenant_id, rid, name, from_type, to_type, cardinality, status)
SELECT t.id, 'order_contains_products', '订单包含产品', 'order', 'product', 'many_to_many', 'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid) DO NOTHING;

INSERT INTO public.ontology_action_types (tenant_id, rid, name, target_type, parameters, permission, workflow_name, hitl_type, status)
SELECT t.id, 'customer.create', '创建客户', 'customer',
       '{"email": "string", "name": "string"}'::jsonb,
       'admin', 'CustomerCreateWorkflow', 'workflow_saas', 'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid) DO NOTHING;

INSERT INTO public.ontology_action_types (tenant_id, rid, name, target_type, parameters, permission, workflow_name, hitl_type, status)
SELECT t.id, 'order.approve', '审批订单', 'order',
       '{"order_id": "uuid", "decision": "string"}'::jsonb,
       'owner', 'OrderApprovalWorkflow', 'workflow_saas', 'active'
FROM public.tenants t
ON CONFLICT (tenant_id, rid) DO NOTHING;

-- 更新 ontology_object_types.link_types (回填可链接的 relation)
UPDATE public.ontology_object_types
SET link_types = ARRAY['customer_has_orders']
WHERE rid = 'customer' AND status = 'active';

UPDATE public.ontology_object_types
SET link_types = ARRAY['customer_has_orders', 'order_contains_products']
WHERE rid = 'order' AND status = 'active';

UPDATE public.ontology_object_types
SET link_types = ARRAY['order_contains_products']
WHERE rid = 'product' AND status = 'active';

-- 更新 ontology_object_types.action_types (回填可触发的 action)
UPDATE public.ontology_object_types
SET action_types = ARRAY['customer.create']
WHERE rid = 'customer' AND status = 'active';

UPDATE public.ontology_object_types
SET action_types = ARRAY['order.approve']
WHERE rid = 'order' AND status = 'active';