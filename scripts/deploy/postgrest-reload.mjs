import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
// PostgREST reload via NOTIFY
await c.query("NOTIFY pgrst, 'reload schema'");
console.log('Sent PostgREST reload signal');
await c.end();
