-- supabase/migrations/20260820120400_create_tg_audit_function.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.3
-- 通用 audit 触发器函数; 每个业务表挂载此触发器自动写 audit_log

CREATE OR REPLACE FUNCTION public.tg_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor  uuid := auth.uid();
    v_tenant uuid;
BEGIN
    -- 批量导入时通过 SET LOCAL audit.disable = on 跳过
    IF current_setting('audit.disable', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE return;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, old_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(OLD.id), to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
        v_tenant := NEW.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, new_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(NEW.id), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        v_tenant := NEW.tenant_id;
        INSERT INTO public.audit_log (tenant_id, actor_id, action, schema_name, table_name, row_pk, old_values, new_values)
        VALUES (v_tenant, v_actor, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, to_jsonb(NEW.id), to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_audit() IS
    '通用 audit 触发器. 业务表通过 CREATE TRIGGER tg_audit AFTER INSERT/UPDATE/DELETE ... FOR EACH ROW EXECUTE FUNCTION public.tg_audit(); 挂载. SET LOCAL audit.disable = on 可临时关闭 (用于批量导入).';