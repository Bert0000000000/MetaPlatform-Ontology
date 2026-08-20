import pg from 'pg';
const { Client } = pg;
const client = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await client.connect();
const r = await client.query(`
  SELECT table_schema, table_name, 
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = t.table_schema AND p.tablename = t.table_name)::int AS policies
  FROM information_schema.tables t
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name`);
console.log(`Total: ${r.rows.length} tables`);
for (const row of r.rows) {
  console.log(`  ${row.table_schema.padEnd(20)} ${row.table_name.padEnd(35)} ${row.policies} policies`);
}
const rls = await client.query("SELECT count(*)::int AS rls_on FROM pg_tables WHERE schemaname='public' AND rowsecurity=true");
console.log(`\n🔒 RLS enabled on ${rls.rows[0].rls_on} public tables`);
await client.end();
