-- supabase/migrations/20260820150000_create_auth_custom_claims_hook.sql
-- PRD: docs/active/prd/auth-jwt-rls.md §4.1
-- Batch: MP-V6-AUTH-01
-- JWT custom_access_token_hook: 注入 tenant_id + role claims

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    claims jsonb;
    v_user_id uuid := (event->>'user_id')::uuid;
    v_tenant_id uuid;
    v_role text;
BEGIN
    -- 从 profiles 表读 tenant_id + role (1:1 with auth.users)
    SELECT p.tenant_id, p.role
    INTO v_tenant_id, v_role
    FROM public.profiles p
    WHERE p.id = v_user_id;

    -- 注入 claims
    claims := event->'claims';

    IF v_tenant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    END IF;

    IF v_role IS NOT NULL THEN
        claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
    ELSE
        claims := jsonb_set(claims, '{role}', to_jsonb('member'));
    END IF;

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
    'Supabase Auth hook: 注入 tenant_id + role claims 到 JWT. 配合 profiles 表 1:1 绑定.
     配置位置: Supabase Dashboard → Auth → Hooks → Custom Access Token → select this fn.';

-- grant execute to supabase_auth_admin (Supabase 内部角色)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;