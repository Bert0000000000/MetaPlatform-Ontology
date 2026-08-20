-- scripts/deploy/post-restore-fixes.sql
-- Apply after supabase stop/start (when DB restored from backup)
-- Fixes common post-restore issues for App Center tests

-- 1) Re-grant all schemas
GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin, authenticator, service_role;
GRANT USAGE ON SCHEMA mp_preset_registry TO anon, authenticated, supabase_auth_admin, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mp_preset_registry TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mp_preset_registry TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mp_preset_registry TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mp_preset_registry GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.install_preset TO anon, authenticated, service_role;

-- 2) is_current column on versions
ALTER TABLE mp_preset_registry.versions ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

-- 3) backfill is_current (latest version per preset is current)
UPDATE mp_preset_registry.versions v
SET is_current = true
WHERE v.id = (
  SELECT id FROM mp_preset_registry.versions v2
  WHERE v2.preset_id = v.preset_id
  ORDER BY v2.created_at DESC LIMIT 1
);

-- 4) For presets without current version, mark the only one as current
UPDATE mp_preset_registry.versions v
SET is_current = true
WHERE v.is_current = false
  AND NOT EXISTS (
    SELECT 1 FROM mp_preset_registry.versions v2
    WHERE v2.preset_id = v.preset_id AND v2.is_current = true
  );

-- 5) Backfill current_version from is_current version
UPDATE mp_preset_registry.presets p
SET current_version = v.version
FROM mp_preset_registry.versions v
WHERE v.preset_id = p.id AND v.is_current = true AND p.current_version IS NULL;

-- 6) Clear tenant_id on public presets (visibility=public)
UPDATE mp_preset_registry.presets SET tenant_id = NULL WHERE visibility = 'public';

-- 7) For private presets, backfill tenant_id from versions
UPDATE mp_preset_registry.versions v
SET tenant_id = (SELECT tenant_id FROM mp_preset_registry.presets p WHERE p.id = v.preset_id)
WHERE v.tenant_id IS NULL;

-- 8) Re-create public.install_preset wrapper
DROP FUNCTION IF EXISTS public.install_preset(uuid, uuid, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.install_preset(
  p_tenant_id uuid, p_preset_id uuid, p_version_id uuid,
  p_workspace_id text, p_config_override jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = mp_preset_registry, public, pg_temp
AS $func$ BEGIN
  UPDATE mp_preset_registry.installs
  SET status = 'uninstalled', uninstalled_at = now()
  WHERE tenant_id = p_tenant_id AND preset_id = p_preset_id
    AND workspace_id = p_workspace_id AND status = 'active';
  INSERT INTO mp_preset_registry.installs
    (tenant_id, preset_id, version_id, workspace_id, config_override, status, installed_by)
  VALUES (p_tenant_id, p_preset_id, p_version_id, p_workspace_id, p_config_override, 'active', p_tenant_id);
  UPDATE mp_preset_registry.presets
  SET downloads_count = downloads_count + 1 WHERE id = p_preset_id;
END; $func$;
GRANT EXECUTE ON FUNCTION public.install_preset TO anon, authenticated, service_role;

-- 9) Re-create custom_access_token_hook (JWT tenant_id + role injection)
DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $func$ DECLARE
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
END; $func$;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin, anon, authenticated, service_role;

-- 10) Fix tg_audit (v_audit_disabled in DECLARE block)
DROP FUNCTION IF EXISTS public.tg_audit();
CREATE OR REPLACE FUNCTION public.tg_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$ DECLARE
    v_actor  uuid := auth.uid();
    v_tenant uuid;
    v_audit_disabled text;
BEGIN
    BEGIN v_audit_disabled := current_setting('audit.disable', true);
    EXCEPTION WHEN OTHERS THEN v_audit_disabled := '';
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
END; $func$;

-- 11) Notify PostgREST to reload
NOTIFY pgrst, 'reload config';
