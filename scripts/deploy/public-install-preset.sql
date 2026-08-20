CREATE OR REPLACE FUNCTION public.install_preset(
  p_tenant_id uuid,
  p_preset_id uuid,
  p_version_id uuid,
  p_workspace_id text,
  p_config_override jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mp_preset_registry, public, pg_temp
AS $func$
BEGIN
  UPDATE mp_preset_registry.installs
  SET status = 'uninstalled', uninstalled_at = now()
  WHERE tenant_id = p_tenant_id AND preset_id = p_preset_id
    AND workspace_id = p_workspace_id AND status = 'active';
  INSERT INTO mp_preset_registry.installs
    (tenant_id, preset_id, version_id, workspace_id, config_override, status, installed_by)
  VALUES (p_tenant_id, p_preset_id, p_version_id, p_workspace_id, p_config_override, 'active', p_tenant_id);
  UPDATE mp_preset_registry.presets
  SET downloads_count = downloads_count + 1 WHERE id = p_preset_id;
END;
$func$;
GRANT EXECUTE ON FUNCTION public.install_preset(uuid, uuid, uuid, text, jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';
