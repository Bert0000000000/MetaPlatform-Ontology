import pg from 'pg';
const { Client } = pg;
const client = new Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
try {
  await client.connect();
  const r1 = await client.query("SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public'");
  console.log(`✅ Public tables: ${r1.rows[0].tables}`);
  const r2 = await client.query("SELECT count(*)::int AS policies FROM pg_policies WHERE schemaname='public'");
  console.log(`✅ RLS policies: ${r2.rows[0].policies}`);
  const r3 = await client.query("SELECT count(*)::int AS jobs FROM cron.job");
  console.log(`✅ pg_cron jobs: ${r3.rows[0].jobs}`);
  const r4 = await client.query("SELECT tablename FROM information_schema.tables WHERE table_schema='public' ORDER BY tablename");
  console.log(`📋 Tables: ${r4.rows.map(r => r.tablename).join(', ')}`);
  await client.end();
} catch (e) { console.error('FAIL:', e.message); process.exit(1); }
