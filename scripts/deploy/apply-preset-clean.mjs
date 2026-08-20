import pg from 'pg';
import fs from 'node:fs';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
await c.query('DROP SCHEMA IF EXISTS mp_preset_registry CASCADE');
// Ensure default tenant for COALESCE fallback
const r = await c.query("SELECT id FROM public.tenants WHERE slug = 'mp-preset-default'");
if (r.rows.length === 0) {
  await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", ['mp-preset-default', 'MP Preset Default Tenant']);
  console.log('Created default tenant');
}
const sql = fs.readFileSync('cleaned-preset.sql', 'utf8');
try {
  await c.query(sql);
  console.log('mp_preset_registry applied OK');
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 200));
}
const r1 = await c.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='mp_preset_registry' AND table_type='BASE TABLE'");
console.log('mp_preset_registry tables:', r1.rows[0].n);
const r2 = await c.query("SELECT count(*)::int AS n FROM mp_preset_registry.presets");
console.log('presets rows:', r2.rows[0].n);
const r3 = await c.query("SELECT count(*)::int AS n FROM mp_preset_registry.versions");
console.log('versions rows:', r3.rows[0].n);
await c.query("ALTER ROLE authenticator SET search_path = public, mp_preset_registry, extensions");
await c.query("NOTIFY pgrst, 'reload config'");
console.log('Schema exposed');
await c.close();
