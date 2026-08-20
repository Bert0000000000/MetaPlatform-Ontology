import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();

const dir = 'supabase/migrations';
const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();

console.log(`Found ${files.length} migration files`);

// Drop public + mp_preset_registry schemas (skip storage which is owned by supabase_admin)
await c.query("DROP SCHEMA IF EXISTS public CASCADE");
await c.query("DROP SCHEMA IF EXISTS mp_preset_registry CASCADE");
await c.query("CREATE SCHEMA public");
console.log('Schemas reset');

let applied = 0, failed = 0;
for (const f of files) {
  const sql = await fs.readFile(path.join(dir, f), 'utf8');
  try {
    await c.query(sql);
    applied++;
  } catch (e) {
    console.log(`  ✗ ${f}: ${e.message.slice(0, 120)}`);
    failed++;
  }
}
console.log(`\nApplied: ${applied}, Failed: ${failed}`);
await c.end();
