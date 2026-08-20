"""Add public.install_preset wrapper function."""
import asyncio
import asyncpg

SQL = """
DROP FUNCTION IF EXISTS public.install_preset(uuid, uuid, uuid, text, jsonb);
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
DECLARE
  v_install_id uuid;
BEGIN
  -- Soft-delete prior
  UPDATE mp_preset_registry.installs
  SET status = 'uninstalled', uninstalled_at = now()
  WHERE tenant_id = p_tenant_id AND preset_id = p_preset_id
    AND workspace_id = p_workspace_id AND status = 'active';

  -- Insert new install
  INSERT INTO mp_preset_registry.installs
    (tenant_id, preset_id, version_id, workspace_id, config_override, status, installed_by)
  VALUES
    (p_tenant_id, p_preset_id, p_version_id, p_workspace_id, p_config_override, 'active', p_tenant_id)
  RETURNING id INTO v_install_id;

  -- Bump downloads count
  UPDATE mp_preset_registry.presets
  SET downloads_count = downloads_count + 1 WHERE id = p_preset_id;
END;
$func$;
GRANT EXECUTE ON FUNCTION public.install_preset(uuid, uuid, uuid, text, jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';
"""

async def main():
    c = await asyncpg.connect(host='localhost', port=54322, user='postgres', password='postgres', database='postgres')
    await c.execute(SQL)
    print('✅ public.install_preset created, grants + reload OK')
    await c.close()

asyncio.run(main())
