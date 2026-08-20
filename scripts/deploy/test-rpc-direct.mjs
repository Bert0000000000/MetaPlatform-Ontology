import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const t = (await c.query("INSERT INTO public.tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id", ['mm-tst-' + Date.now(), 'MMT'])).rows[0].id;
console.log('tenant:', t);
const v = Array(512).fill(0).join(',');
try {
  const r = await c.query('SELECT insert_image_embedding($1, $2, $3, $4, $5) AS id', [t, 'http://x.com/t5.jpg', 'h-' + Date.now(), '[' + v + ']', '{}']);
  console.log('inserted:', r.rows[0].id);
  const r2 = await c.query("SELECT count(*)::int AS n FROM public.audit_log WHERE row_pk->>'id'::text IS NOT NULL AND tenant_id = $1", [t]);
  console.log('audit_log for tenant:', r2.rows[0]);
  await c.query("DELETE FROM public.image_embeddings WHERE image_url = $1", ['http://x.com/t5.jpg']);
} catch (e) {
  console.log('err:', e.message.slice(0, 200));
}
await c.query("DELETE FROM public.tenants WHERE id = $1", [t]);
await c.end();
