import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%notif%'");
console.log('notification tables:', r.rows.map(x => x.table_name));
await c.end();
