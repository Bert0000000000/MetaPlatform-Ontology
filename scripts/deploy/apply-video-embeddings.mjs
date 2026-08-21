// scripts/deploy/apply-video-embeddings.mjs
// One-shot: apply video_embeddings migration directly to running Supabase
import pg from 'pg';
import fs from 'node:fs';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const sql = fs.readFileSync('supabase/migrations/20260820400000_create_video_embeddings.sql', 'utf8');
try {
  await c.query(sql);
  console.log('OK video_embeddings migration applied');
} catch (e) {
  console.error('FAIL apply:', e.message);
  process.exit(1);
}
await c.query("NOTIFY pgrst, 'reload schema'");
await c.query("NOTIFY pgrst, 'reload config'");
const r = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'video_embeddings' ORDER BY ordinal_position");
console.log('Columns:', r.rows.map(x => x.column_name + ':' + x.data_type).join(', '));
const rls = await c.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('video_embeddings','image_embeddings') AND relnamespace = 'public'::regnamespace");
console.log('RLS:', rls.rows.map(x => x.relname + '=' + x.relrowsecurity).join(', '));
await c.end();