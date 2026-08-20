import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
try {
  const tenant = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) RETURNING id", ['itest-' + Date.now(), 'ITest'])).rows[0].id;
  console.log('tenant:', tenant);
  const r = await c.query("SELECT public.insert_image_embedding($1::uuid, $2::text, $3::text, $4::text, $5::jsonb) AS row",
    [tenant, 'https://x.com/i.jpg', 'hash456', '[' + new Array(512).fill(0).join(',') + ']', {}]);
  console.log('insert_image_embedding ok:', r.rows[0].row);
} catch (e) { console.log('insert_image_embedding FAIL:', e.message); }
await c.end();
