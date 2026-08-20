import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
await c.query("DROP FUNCTION IF EXISTS public.insert_video_embedding(uuid, text, text, numeric, int, uuid, int, numeric, text, jsonb)");
await c.query("NOTIFY pgrst, 'reload schema'");
console.log('OK dropped text overload');
const r = await c.query("SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'insert_video_embedding'");
console.log('remaining:', r.rows);
await c.end();
