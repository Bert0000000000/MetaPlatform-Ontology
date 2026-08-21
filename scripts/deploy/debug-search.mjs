import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
const r = await c.query("SELECT id, image_url, (1 - (embedding <=> '[0]'::vector))::text AS sim FROM public.image_embeddings LIMIT 3");
console.log('zero vector sim:', r.rows);
// Use small non-zero vector
const vec = '[' + new Array(512).fill(0.01).join(',') + ']';
const r2 = await c.query("SELECT id, image_url, (1 - (embedding <=> $1::vector))::text AS sim FROM public.image_embeddings LIMIT 3", [vec]);
console.log('zero-vs-0.01:', r2.rows);
await c.end();