import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const sql = await (await import('node:fs/promises')).readFile('supabase/migrations/20260820130940_create_notifications_table.sql', 'utf8');
await c.query(sql);
console.log('✅ notifications table created');
await c.end();
