-- supabase/migrations/20260820621000_seed_ontology_on_tenant_create.sql
-- PRD:  docs/active/prd/mp-ontology.md
-- 新租户创建时自动 seed 4 ObjectType + 2 Relation + 2 Action (M11 内置基础本体)

CREATE OR REPLACE FUNCTION public.seed_ontology_for_new_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rid text;
BEGIN
    -- 跳过 audit_log 写入 (新租户 seed 是 system-init, 不需要逐行审计
    -- 且与 cascade delete 冲突: ontology_* ON DELETE CASCADE 重新 INSERT audit_log 时
    -- FK 已不可见 — 见 migration 20260820622000)
    PERFORM set_config('audit.disable', 'on', true);

    -- ObjectTypes (4)
    FOR v_rid IN SELECT unnest(ARRAY['customer', 'order', 'product', 'contract']) LOOP
        INSERT INTO public.ontology_object_types (tenant_id, rid, slug, name, properties, status)
        VALUES (
            NEW.id,
            v_rid,
            v_rid,
            CASE v_rid
                WHEN 'customer' THEN '客户'
                WHEN 'order'    THEN '订单'
                WHEN 'product'  THEN '产品'
                WHEN 'contract' THEN '合同'
            END,
            CASE v_rid
                WHEN 'customer' THEN '{"email": {"type": "string", "required": true}, "phone": {"type": "string"}, "name": {"type": "string", "required": true}}'::jsonb
                WHEN 'order'    THEN '{"amount": {"type": "number", "required": true}, "status": {"type": "string", "enum": ["draft", "pending_approval", "approved", "rejected", "fulfilled"]}}'::jsonb
                WHEN 'product'  THEN '{"sku": {"type": "string", "required": true}, "name": {"type": "string", "required": true}, "price": {"type": "number"}}'::jsonb
                WHEN 'contract' THEN '{"title": {"type": "string", "required": true}, "amount": {"type": "number"}, "status": {"type": "string", "enum": ["draft", "active", "archived"]}}'::jsonb
            END,
            'active'
        )
        ON CONFLICT (tenant_id, rid, version) DO NOTHING;
    END LOOP;

    -- Relations (2)
    INSERT INTO public.ontology_relation_types (tenant_id, rid, name, from_type, to_type, cardinality, status)
    VALUES
        (NEW.id, 'customer_has_orders',     '客户拥有订单',     'customer', 'order',   'one_to_many',   'active'),
        (NEW.id, 'order_contains_products', '订单包含产品',     'order',    'product', 'many_to_many',  'active')
    ON CONFLICT (tenant_id, rid) DO NOTHING;

    -- Actions (2)
    INSERT INTO public.ontology_action_types (tenant_id, rid, name, target_type, parameters, permission, workflow_name, hitl_type, status)
    VALUES
        (NEW.id, 'customer.create', '创建客户', 'customer', '{"email": "string", "name": "string"}'::jsonb,             'admin', 'CustomerCreateWorkflow', 'workflow_saas', 'active'),
        (NEW.id, 'order.approve',   '审批订单', 'order',    '{"order_id": "uuid", "decision": "string"}'::jsonb,    'owner', 'OrderApprovalWorkflow',   'workflow_saas', 'active')
    ON CONFLICT (tenant_id, rid) DO NOTHING;

    -- 回填 ObjectType 的 link_types + action_types
    UPDATE public.ontology_object_types SET link_types = ARRAY['customer_has_orders']
        WHERE tenant_id = NEW.id AND rid = 'customer';
    UPDATE public.ontology_object_types SET link_types = ARRAY['customer_has_orders', 'order_contains_products']
        WHERE tenant_id = NEW.id AND rid = 'order';
    UPDATE public.ontology_object_types SET link_types = ARRAY['order_contains_products']
        WHERE tenant_id = NEW.id AND rid = 'product';
    UPDATE public.ontology_object_types SET action_types = ARRAY['customer.create']
        WHERE tenant_id = NEW.id AND rid = 'customer';
    UPDATE public.ontology_object_types SET action_types = ARRAY['order.approve']
        WHERE tenant_id = NEW.id AND rid = 'order';

    -- 恢复 audit_log 写入
    PERFORM set_config('audit.disable', '', true);

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_ontology_for_new_tenant() IS
    'M11: 新租户创建时自动 seed 4 ObjectType + 2 Relation + 2 Action 内置本体. AFTER INSERT ON public.tenants.';

CREATE TRIGGER tg_tenants_seed_ontology
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.seed_ontology_for_new_tenant();