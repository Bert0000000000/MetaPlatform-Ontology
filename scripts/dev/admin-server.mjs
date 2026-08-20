// scripts/dev/admin-server.mjs
// MP-V6 mp-platform 管理后台 PoC
// PRD: docs/active/prd/mp-platform.md
// Issue: #7 (12w P0)
// PoC: minimal Node + pg + plain HTML dashboard
//
// 运行: node scripts/dev/admin-server.mjs
// 访问: http://127.0.0.1:8080

import http from 'node:http';
import pg from 'pg';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();

const port = 8080;

function html(body) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><title>mp-platform 管理后台</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 0; background: #f5f5f5; }
header { background: #1a1a1a; color: white; padding: 20px; }
h1 { margin: 0; font-size: 20px; }
main { padding: 20px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.card h2 { margin: 0 0 16px 0; font-size: 16px; color: #333; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
th { background: #fafafa; font-weight: 600; }
.badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
.badge-green { background: #d1fae5; color: #065f46; }
.badge-blue { background: #dbeafe; color: #1e40af; }
.badge-red { background: #fee2e2; color: #991b1b; }
</style></head><body>
<header><h1>mp-platform 管理后台 PoC</h1></header>
<main>${body}</main>
</body></html>`;
}

function card(title, table) {
  return `<div class="card"><h2>${title}</h2>${table}</div>`;
}

function renderTable(rows, cols) {
  if (rows.length === 0) return '<p style="color:#999">无数据</p>';
  return `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${r[c.toLowerCase()] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/admin') {
    // Aggregate stats
    const [tenants, users, audits, installs, presets, cron] = await Promise.all([
      c.query('SELECT count(*)::int AS n FROM public.tenants'),
      c.query('SELECT count(*)::int AS n FROM auth.users'),
      c.query("SELECT count(*)::int AS n FROM public.audit_log WHERE created_at > now() - interval '24 hours'"),
      c.query("SELECT count(*)::int AS n FROM mp_preset_registry.installs WHERE status = 'active'"),
      c.query('SELECT count(*)::int AS n FROM mp_preset_registry.presets'),
      c.query('SELECT count(*)::int AS n FROM cron.job WHERE active = true'),
    ]);
    const body = `
      ${card('Tenants', renderTable([{ n: tenants.rows[0].n }], ['N']))}
      ${card('Auth Users', renderTable([{ n: users.rows[0].n }], ['N']))}
      ${card('Audit Log (24h)', renderTable([{ n: audits.rows[0].n }], ['N']))}
      ${card('Active Installs', renderTable([{ n: installs.rows[0].n }], ['N']))}
      ${card('Presets', renderTable([{ n: presets.rows[0].n }], ['N']))}
      ${card('pg_cron Jobs', renderTable([{ n: cron.rows[0].n }], ['N']))}
      <div class="card"><h2>导航</h2>
        <ul>
          <li><a href="/admin/tenants">Tenants</a></li>
          <li><a href="/admin/audit">Audit Log</a></li>
          <li><a href="/admin/installs">Installs</a></li>
          <li><a href="/admin/presets">Presets</a></li>
          <li><a href="/admin/cron">Cron Jobs</a></li>
        </ul>
      </div>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(body));
  } else if (req.url === '/admin/tenants') {
    const r = await c.query("SELECT id, slug, name, status, created_at FROM public.tenants ORDER BY created_at DESC LIMIT 50");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(card('Tenants', renderTable(r.rows, ['id', 'slug', 'name', 'status', 'created_at']))));
  } else if (req.url === '/admin/audit') {
    const r = await c.query("SELECT id, tenant_id, actor_id, action, schema_name, table_name, occurred_at FROM public.audit_log ORDER BY occurred_at DESC LIMIT 100");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(card('Audit Log (latest 100)', renderTable(r.rows, ['id', 'tenant_id', 'actor_id', 'action', 'schema_name', 'table_name', 'occurred_at']))));
  } else if (req.url === '/admin/installs') {
    const r = await c.query("SELECT i.id, p.slug AS preset, i.workspace_id, i.status, i.installed_at FROM mp_preset_registry.installs i LEFT JOIN mp_preset_registry.presets p ON p.id = i.preset_id ORDER BY i.installed_at DESC LIMIT 50");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(card('Installs', renderTable(r.rows, ['id', 'preset', 'workspace_id', 'status', 'installed_at']))));
  } else if (req.url === '/admin/presets') {
    const r = await c.query("SELECT slug, name, visibility, downloads_count, current_version, maintainer_id FROM mp_preset_registry.presets ORDER BY downloads_count DESC LIMIT 50");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(card('Presets', renderTable(r.rows, ['slug', 'name', 'visibility', 'downloads_count', 'current_version', 'maintainer_id']))));
  } else if (req.url === '/admin/cron') {
    const r = await c.query("SELECT jobname, schedule, active FROM cron.job ORDER BY jobname");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(card('pg_cron Jobs', renderTable(r.rows, ['jobname', 'schedule', 'active']))));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('mp-platform admin server on http://127.0.0.1:' + port);
});
