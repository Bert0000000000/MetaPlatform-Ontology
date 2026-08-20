-- supabase/migrations/20260820120500_rls_baseline_policies.sql
-- PRD: docs/active/prd/foundation-rls-policy.md
-- 基础 RLS policy 模板; 业务表直接复用

-- service_role 全权策略（每个表都加） — 由 service_role bypass RLS 的特性,
-- 这里显式记录 service_role 可访问, 便于审计. 实际 RLS bypass 在 Supabase
-- Postgres role 层就生效 (service_role = BYPASSRLS).

-- 模板：tenant 隔离 SELECT
CREATE OR REPLACE FUNCTION public._policy_tenant_select(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_select', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 INSERT (要求 JWT.tenant_id == NEW.tenant_id)
CREATE OR REPLACE FUNCTION public._policy_tenant_insert(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_insert', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 UPDATE
CREATE OR REPLACE FUNCTION public._policy_tenant_update(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_update', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid) WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)',
        policy_name, p_table
    );
END;
$$;

-- 模板：tenant 隔离 DELETE (仅 owner / admin)
CREATE OR REPLACE FUNCTION public._policy_tenant_delete(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    policy_name text := format('rls_%s_tenant_delete', p_table::text);
BEGIN
    EXECUTE format(
        'CREATE POLICY %I ON %s FOR DELETE TO authenticated USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid AND (auth.jwt() ->> ''role'') IN (''owner'', ''admin''))',
        policy_name, p_table
    );
END;
$$;

COMMENT ON FUNCTION public._policy_tenant_select(regclass) IS 'RLS 模板: tenant 隔离 SELECT. 业务表调用: SELECT public._policy_tenant_select(''orders''::regclass);';
COMMENT ON FUNCTION public._policy_tenant_insert(regclass) IS 'RLS 模板: tenant 隔离 INSERT. WITH CHECK 强制 JWT.tenant_id == NEW.tenant_id.';
COMMENT ON FUNCTION public._policy_tenant_update(regclass) IS 'RLS 模板: tenant 隔离 UPDATE.';
COMMENT ON FUNCTION public._policy_tenant_delete(regclass) IS 'RLS 模板: tenant 隔离 DELETE (仅 owner / admin).';