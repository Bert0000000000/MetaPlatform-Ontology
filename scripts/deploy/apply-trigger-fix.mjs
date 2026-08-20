import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const sql = await (await import('node:fs/promises')).readFile('supabase/migrations/20260820130930_fix_tg_inject_tenant_trigger.sql', 'utf8');
await c.query(sql);
console.log('Trigger re-applied');
await c.end();
