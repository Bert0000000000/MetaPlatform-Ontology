-- supabase/migrations/20260820120600_tg_inject_tenant.sql
-- PRD: docs/active/prd/foundation-rls-policy.md §4.3
-- 自动注入 tenant_id: 业务 INSERT 即使忘记填 tenant_id, 触发器从 JWT 注入.
-- 与 RLS policy 配合: WITH CHECK 保证 JWT.tenant_id == row.tenant_id.

CREATE OR REPLACE FUNCTION public.tg_inject_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
BEGIN
    IF jwt_tenant IS NULL THEN
        RAISE EXCEPTION 'tg_inject_tenant: JWT missing tenant_id claim'
            USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;

    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := jwt_tenant;
    ELSIF NEW.tenant_id <> jwt_tenant THEN
        RAISE EXCEPTION 'tg_inject_tenant: row.tenant_id (%) != JWT.tenant_id (%)',
            NEW.tenant_id, jwt_tenant
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_inject_tenant() IS
    '业务表 INSERT 前自动注入 tenant_id (从 JWT). 与 RLS WITH CHECK 双重保证多租户隔离. 业务表挂载: CREATE TRIGGER tg_inject BEFORE INSERT ON <table> FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();';