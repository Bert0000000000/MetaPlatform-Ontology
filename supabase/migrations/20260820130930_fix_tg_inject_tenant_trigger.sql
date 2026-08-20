-- supabase/migrations/20260820130930_fix_tg_inject_tenant_trigger.sql
-- Fix: tg_inject_tenant trigger raised when JWT missing tenant_id
-- v6.1 correct behavior: priority NEW.tenant_id > JWT > profiles > error

CREATE OR REPLACE FUNCTION public.tg_inject_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    jwt_tenant uuid;
    v_user_id uuid := auth.uid();
    v_tenant uuid;
BEGIN
    BEGIN
        jwt_tenant := (auth.jwt() ->> 'tenant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
        jwt_tenant := NULL;
    END;

    IF NEW.tenant_id IS NOT NULL THEN
        IF jwt_tenant IS NOT NULL AND NEW.tenant_id <> jwt_tenant THEN
            RAISE EXCEPTION 'tg_inject_tenant: row.tenant_id (%) != JWT.tenant_id (%)',
                NEW.tenant_id, jwt_tenant
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF jwt_tenant IS NOT NULL THEN
        NEW.tenant_id := jwt_tenant;
        RETURN NEW;
    END IF;

    IF v_user_id IS NOT NULL THEN
        SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_user_id;
        IF v_tenant IS NOT NULL THEN
            NEW.tenant_id := v_tenant;
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'tg_inject_tenant: cannot determine tenant_id (NEW.tenant_id, auth.jwt(), profiles all NULL)'
        USING ERRCODE = '42501';
END;
$$;
