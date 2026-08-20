// mp-platform/web/scripts/admin-api.mjs
// mp-platform 管理后台本地 API (PoC Sprint 1 升级版)
// - 取代 admin-server.mjs 的 HTML-only 输出, 改为 JSON API
// - 端口 8081, Vite dev proxy 把 /api/* 转发到这
// - 直接连 Supabase Postgres (54322), 不经 PostgREST 即可跨 schema 查询
//
// 路由:
//   GET /api/health                                    -> { ok: true }
//   GET /api/stats                                     -> 6 dashboard 卡片数据
//   GET /api/tenants?search=&status=                   -> tenants 列表
//   GET /api/audit?from=&to=&actor=&action=            -> audit log
//   GET /api/presets                                   -> presets 列表
//   GET /api/installs                                  -> installs 列表
//   GET /api/cron                                      -> pg_cron jobs
//
// Env:
//   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
//   API_TOKEN (可选, dev 鉴权; 默认不要求)

import http from 'node:http';
import pg from 'pg';

const port = 8081;
const HOST = '127.0.0.1';

const c = new pg.Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
});

await c.connect();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

function queryParams(req) {
  const u = new URL(req.url, 'http://x');
  const o = {};
  for (const [k, v] of u.searchParams) o[k] = v;
  return o;
}

async function handleStats() {
  const [tenants, users, audits, installs, presets, cron] = await Promise.all([
    c.query('SELECT count(*)::int AS n FROM public.tenants'),
    c.query('SELECT count(*)::int AS n FROM auth.users'),
    c.query("SELECT count(*)::int AS n FROM public.audit_log WHERE occurred_at > now() - interval '24 hours'"),
    c.query("SELECT count(*)::int AS n FROM mp_preset_registry.installs WHERE status = 'active'"),
    c.query('SELECT count(*)::int AS n FROM mp_preset_registry.presets'),
    c.query('SELECT count(*)::int AS n FROM cron.job WHERE active = true'),
  ]);
  return {
    tenants: tenants.rows[0].n,
    users: users.rows[0].n,
    audits24h: audits.rows[0].n,
    installs: installs.rows[0].n,
    presets: presets.rows[0].n,
    cron: cron.rows[0].n,
  };
}

async function handleTenants(params) {
  const where = [];
  const args = [];
  if (params.search) {
    args.push(`%${params.search.toLowerCase()}%`);
    where.push(`(lower(slug) LIKE $${args.length} OR lower(name) LIKE $${args.length})`);
  }
  if (params.status) {
    args.push(params.status);
    where.push(`status = $${args.length}`);
  }
  const sql = `SELECT id, slug, name, status, created_at FROM public.tenants ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY created_at DESC LIMIT 200`;
  const r = await c.query(sql, args);
  return r.rows;
}

async function handleAudit(params) {
  const where = [];
  const args = [];
  if (params.from) {
    args.push(params.from);
    where.push(`occurred_at >= $${args.length}`);
  }
  if (params.to) {
    args.push(params.to);
    where.push(`occurred_at <= $${args.length}`);
  }
  if (params.actor) {
    args.push(params.actor);
    where.push(`actor_id::text = $${args.length}`);
  }
  if (params.action) {
    args.push(params.action);
    where.push(`action = $${args.length}`);
  }
  const sql = `SELECT id, tenant_id, actor_id, action, schema_name, table_name, occurred_at FROM public.audit_log ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY occurred_at DESC LIMIT 200`;
  const r = await c.query(sql, args);
  return r.rows;
}

async function handlePresets() {
  const r = await c.query(
    'SELECT slug, name, visibility, downloads_count, current_version, maintainer_id, updated_at FROM mp_preset_registry.presets ORDER BY downloads_count DESC LIMIT 200'
  );
  return r.rows;
}

async function handleInstalls() {
  const r = await c.query(
    `SELECT i.id, p.slug AS preset, i.workspace_id, i.status, i.installed_at
     FROM mp_preset_registry.installs i
     LEFT JOIN mp_preset_registry.presets p ON p.id = i.preset_id
     ORDER BY i.installed_at DESC LIMIT 200`
  );
  return r.rows;
}

async function handleCron() {
  const r = await c.query('SELECT jobname, schedule, active FROM cron.job ORDER BY jobname');
  return r.rows;
}

const routes = {
  'GET /api/health': async (_req, res) => {
    json(res, 200, { ok: true, version: '6.0.0-sprint1', ts: new Date().toISOString() });
  },
  'GET /api/stats': async (_req, res) => {
    try {
      const stats = await handleStats();
      json(res, 200, stats);
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
  'GET /api/tenants': async (req, res) => {
    try {
      const data = await handleTenants(queryParams(req));
      json(res, 200, data);
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
  'GET /api/audit': async (req, res) => {
    try {
      const data = await handleAudit(queryParams(req));
      json(res, 200, data);
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
  'GET /api/presets': async (_req, res) => {
    try {
      json(res, 200, await handlePresets());
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
  'GET /api/installs': async (_req, res) => {
    try {
      json(res, 200, await handleInstalls());
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
  'GET /api/cron': async (_req, res) => {
    try {
      json(res, 200, await handleCron());
    } catch (e) { json(res, 500, { error: String(e) }); }
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = req.url?.split('?')[0] ?? '/';
  const key = `${req.method} ${url}`;
  const handler = routes[key];
  if (!handler) {
    return json(res, 404, { error: 'not found', key });
  }
  try {
    await handler(req, res);
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(port, HOST, () => {
  console.log(`▶  mp-platform admin-api on http://${HOST}:${port}`);
});
