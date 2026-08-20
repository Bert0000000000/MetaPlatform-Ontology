import pg from 'pg';
const { Client } = pg;
const c = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
await c.query("ALTER ROLE authenticator SET search_path = public, mp_preset_registry, cron, storage, graphql, extensions");
await c.query("NOTIFY pgrst, 'reload config'");
console.log('Schema exposed + reload sent');
await c.end();
