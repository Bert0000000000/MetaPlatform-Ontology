DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $func$
DECLARE
    claims jsonb;
    v_user_id uuid := (event->>'user_id')::uuid;
    v_tenant_id uuid;
    v_role text;
    v_app_meta jsonb;
BEGIN
    v_app_meta := COALESCE(event->'app_metadata', event->'user_metadata'->'app_metadata', '{}'::jsonb);
    v_tenant_id := NULLIF((v_app_meta->>'tenant_id'), '')::uuid;
    v_role := v_app_meta->>'role';
    IF v_tenant_id IS NULL OR v_role IS NULL THEN
        SELECT p.tenant_id, p.role INTO v_tenant_id, v_role
        FROM public.profiles p WHERE p.id = v_user_id;
    END IF;
    v_tenant_id := COALESCE(v_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_role := COALESCE(v_role, 'member');
    claims := event->'claims';
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
    RETURN jsonb_set(event, '{claims}', claims);
END;
$func$;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';
