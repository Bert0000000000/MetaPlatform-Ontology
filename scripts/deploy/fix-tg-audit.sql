CREATE OR REPLACE FUNCTION public.tg_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_actor  uuid := auth.uid();
    v_tenant uuid;
    v_audit_disabled text;
BEGIN
    BEGIN
        v_audit_disabled := current_setting('audit.disable', true);
    EXCEPTION WHEN OTHERS THEN
        v_audit_disabled := '';
    END;
    IF v_audit_disabled = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
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
$func$;
