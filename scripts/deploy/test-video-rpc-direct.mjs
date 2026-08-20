import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
try {
  // Test direct SQL cast first
  const r1 = await c.query("SELECT '[1,2,3]'::text::vector AS v1, '[1,2,3]'::text::vector(512) AS v2");
  console.log('cast ok:', r1.rows[0]);
} catch (e) { console.log('cast FAIL:', e.message); }

// Now test insert_video_embedding directly (without service role bypassing)
try {
  const tenant = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['vtest-' + Date.now(), 'VTest'])).rows[0].id;
  console.log('tenant:', tenant);
  const r = await c.query("SELECT public.insert_video_embedding($1::uuid, $2::text, $3::text, $4::numeric, $5::int, NULL::uuid, $6::int, $7::numeric, $8::text, $9::jsonb) AS row",
    [tenant, 'https://x.com/v.mp4', 'hash123', 10.0, 1, 0, 0.0, '[' + new Array(512).fill(0).join(',') + ']', {}]);
  console.log('insert_video_embedding ok:', r.rows[0].row);
} catch (e) { console.log('insert_video_embedding FAIL:', e.message); }
await c.end();
