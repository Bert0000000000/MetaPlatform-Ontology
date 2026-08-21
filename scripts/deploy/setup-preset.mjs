// scripts/deploy/setup-preset.mjs
// One-stop setup: apply schema + grant permissions + backfill
import pg from 'pg';
import fs from 'node:fs';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();

// 1) Apply mp_preset_registry schema (from cleaned-preset.sql)
const sql = fs.readFileSync('cleaned-preset.sql', 'utf8');
try { await c.query(sql); } catch (e) { console.log('Schema apply:', e.message.slice(0,100)); }

// 2) Ensure default tenant
const t = await c.query("SELECT id FROM public.tenants WHERE slug = 'mp-preset-default'");
if (t.rows.length === 0) {
  await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['mp-preset-default', 'MP Preset Default Tenant']);
}

// 3) Backfill latest_version / is_current
await c.query("ALTER TABLE mp_preset_registry.versions ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false");
await c.query(`UPDATE mp_preset_registry.versions v SET is_current = true
  WHERE v.id = (SELECT id FROM mp_preset_registry.versions v2
                WHERE v2.preset_id = v.preset_id ORDER BY created_at DESC LIMIT 1)`);
await c.query(`UPDATE mp_preset_registry.presets p
  SET current_version = v.version
  FROM mp_preset_registry.versions v
  WHERE v.preset_id = p.id AND v.is_current = true`);

// 4) Grants (lost on restart)
await c.query('GRANT USAGE ON SCHEMA mp_preset_registry TO anon, authenticated, service_role');
await c.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mp_preset_registry TO anon, authenticated, service_role');
await c.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mp_preset_registry TO anon, authenticated, service_role');
await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA mp_preset_registry GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role');
await c.query('GRANT EXECUTE ON FUNCTION mp_preset_registry.install_preset TO anon, authenticated, service_role');
await c.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin');
await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, supabase_auth_admin');
// Legacy: the install-preset Edge Function now targets schema 'mp_preset_registry' directly,
// so the public.install_preset wrapper is optional. Grant it only if it still exists —
// an unguarded GRANT here throws 42883 and aborts the rest of setup.
await c.query(`DO $$
BEGIN
  IF to_regprocedure('public.install_preset(uuid, uuid, uuid, text, jsonb)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.install_preset(uuid, uuid, uuid, text, jsonb) TO anon, authenticated, service_role;
  END IF;
END $$;`);

// 5) Re-apply Phase 2 video_embeddings migration (idempotent: CREATE IF NOT EXISTS + CREATE OR REPLACE).
//    On Supabase restart, custom migrations under supabase/migrations/ are NOT re-applied automatically;
//    this step ensures video_embeddings + insert_video_embedding RPC persist across restarts.
try {
  const videoSql = fs.readFileSync('supabase/migrations/20260820400000_create_video_embeddings.sql', 'utf8');
  await c.query(videoSql);
  console.log('OK video_embeddings migration re-applied');
} catch (e) {
  console.log('video_embeddings apply:', e.message.slice(0, 100));
}
// Re-grant the RPC in case the CREATE OR REPLACE above wiped grants on Supabase restart
try {
  await c.query("GRANT EXECUTE ON FUNCTION public.insert_video_embedding(uuid, text, text, numeric, int, uuid, int, numeric, vector, jsonb) TO anon, authenticated, service_role");
  await c.query("GRANT EXECUTE ON FUNCTION public.search_video_frames(vector, uuid, int) TO anon, authenticated, service_role");
  await c.query("GRANT EXECUTE ON FUNCTION public.video_url_hash(text) TO anon, authenticated, service_role");
} catch (e) {
  console.log('video RPC grant:', e.message.slice(0, 100));
}

// 6) Re-apply public-schema GRANTs for Edge Function writes.
//    Edge Functions build their supabase client with SUPABASE_SERVICE_ROLE_KEY, so PostgREST
//    does `SET ROLE service_role`. service_role has no table privileges on public.* by default
//    here (post-restore-fixes.sql only grants anon/authenticated), which surfaces as
//    `42501 permission denied for table customers|hitl_requests` -> Edge Function 500.
//    This migration is pure GRANTs (idempotent) and must be replayed after every restart/reset.
try {
  const grantsSql = fs.readFileSync('supabase/migrations/20260820600000_grants_for_ef_writes.sql', 'utf8');
  await c.query(grantsSql);
  console.log('OK public-schema grants re-applied (service_role + authenticator)');
} catch (e) {
  console.log('grants apply:', e.message.slice(0, 200));
}

// 7) Notify PostgREST
await c.query("NOTIFY pgrst, 'reload config'");
await c.query("NOTIFY pgrst, 'reload schema'");

console.log('OK mp_preset_registry + video_embeddings + public grants fully configured');
await c.end();
