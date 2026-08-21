// scripts/dev/admin-server.mjs
// MetaPlatform Ontology 本体平台 (mp-platform admin UI)
// v2: 用 Semi Design 19 CSS (CDN) 重构布局, 满足应用架构 PRD §4.1 UI 规范
//   - Sider + Header + Content + Footer Layout
//   - Nav items with icons (semi-icons CDN)
//   - Statistic cards / Table / Tag / Card / Breadcrumb
//   - 响应式: 6 个 breakpoint (xs/sm/md/lg/xl/xxl)
//
// 数据源: Supabase PG (port 54322) — ontology / hitl / dsh_session / mp_sandbox / audit_log
// 服务路由: 14 个 (/ + /admin/* + /app-center)

import http from 'node:http';
import pg from 'pg';

const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();

const port = 8080;
const SEMI_CSS = 'https://unpkg.byted-static.com/ies/semi-css-v2@2.49.1/semi.css';
const SEMI_ICONS_CSS = 'https://unpkg.byted-static.com/ies/semi-icons-v2@1.3.0/semi-icons.css';

// -------------------------------------------------------------------------
// 通用 layout (Semi Design Sider + Header + Content + Footer)
// -------------------------------------------------------------------------
function layout(opts) {
  const { title, body, activeNav } = opts;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · MetaPlatform</title>
<link rel="stylesheet" href="${SEMI_CSS}">
<link rel="stylesheet" href="${SEMI_ICONS_CSS}">
<style>
  body { margin: 0; font-family: var(--semi-font-family-regular); background: var(--semi-color-bg-0); color: var(--semi-color-text-0); }
  .mp-shell { min-height: 100vh; display: flex; }
  .mp-sider { width: 220px; background: var(--semi-color-bg-1); border-right: 1px solid var(--semi-color-border); flex-shrink: 0; }
  .mp-sider-brand { padding: 20px 24px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--semi-color-border); }
  .mp-sider-brand-logo { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #4f46e5, #06b6d4); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; }
  .mp-sider-brand-name { font-size: 16px; font-weight: 600; }
  .mp-sider-brand-sub { font-size: 11px; color: var(--semi-color-text-2); }
  .mp-sider-nav { padding: 12px 8px; }
  .mp-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 6px; color: var(--semi-color-text-1); text-decoration: none; font-size: 14px; margin-bottom: 2px; }
  .mp-nav-item:hover { background: var(--semi-color-fill-1); color: var(--semi-color-text-0); }
  .mp-nav-item.active { background: var(--semi-color-primary-light-default); color: var(--semi-color-primary); font-weight: 500; }
  .mp-nav-icon { font-size: 16px; }
  .mp-nav-group { padding: 12px 14px 6px; font-size: 11px; color: var(--semi-color-text-2); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .mp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .mp-header { height: 56px; background: var(--semi-color-bg-1); border-bottom: 1px solid var(--semi-color-border); display: flex; align-items: center; padding: 0 24px; gap: 16px; }
  .mp-header-title { font-size: 16px; font-weight: 600; flex: 1; }
  .mp-header-meta { color: var(--semi-color-text-2); font-size: 12px; }
  .mp-content { flex: 1; padding: 24px; overflow: auto; background: var(--semi-color-bg-0); }
  .mp-footer { padding: 12px 24px; text-align: center; color: var(--semi-color-text-2); font-size: 12px; border-top: 1px solid var(--semi-color-border); background: var(--semi-color-bg-1); }
  .mp-breadcrumb { margin-bottom: 16px; }
  .mp-breadcrumb-item { color: var(--semi-color-text-2); font-size: 13px; }
  .mp-breadcrumb-sep { margin: 0 6px; color: var(--semi-color-text-2); }
  .mp-page-header { margin-bottom: 20px; }
  .mp-page-title { font-size: 22px; font-weight: 600; margin: 0 0 4px 0; }
  .mp-page-sub { color: var(--semi-color-text-2); font-size: 13px; }
  .mp-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .mp-stat-card { background: var(--semi-color-bg-1); border: 1px solid var(--semi-color-border); border-radius: 8px; padding: 20px; }
  .mp-stat-label { color: var(--semi-color-text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .mp-stat-value { font-size: 28px; font-weight: 600; margin-top: 8px; }
  .mp-stat-value.primary { color: var(--semi-color-primary); }
  .mp-stat-value.success { color: var(--semi-color-success); }
  .mp-stat-value.warning { color: var(--semi-color-warning); }
  .mp-stat-value.danger { color: var(--semi-color-danger); }
  .mp-stat-trend { font-size: 11px; color: var(--semi-color-text-2); margin-top: 4px; }
  .mp-card { background: var(--semi-color-bg-1); border: 1px solid var(--semi-color-border); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .mp-card-title { font-size: 15px; font-weight: 600; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; }
  .mp-card-title .mp-icon { font-size: 16px; }
  .mp-card-sub { font-size: 12px; color: var(--semi-color-text-2); margin-bottom: 12px; }
  .mp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .mp-table th { background: var(--semi-color-fill-0); color: var(--semi-color-text-1); font-weight: 500; text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--semi-color-border); }
  .mp-table td { padding: 10px 12px; border-bottom: 1px solid var(--semi-color-border); }
  .mp-table tr:last-child td { border-bottom: 0; }
  .mp-table tr:hover td { background: var(--semi-color-fill-0); }
  .mp-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
  .mp-tag.success { background: var(--semi-color-success-light-default); color: var(--semi-color-success); }
  .mp-tag.warning { background: var(--semi-color-warning-light-default); color: var(--semi-color-warning); }
  .mp-tag.danger { background: var(--semi-color-danger-light-default); color: var(--semi-color-danger); }
  .mp-tag.primary { background: var(--semi-color-primary-light-default); color: var(--semi-color-primary); }
  .mp-tag.grey { background: var(--semi-color-fill-1); color: var(--semi-color-text-2); }
  .mp-empty { text-align: center; padding: 60px 20px; color: var(--semi-color-text-2); }
  .mp-empty-icon { font-size: 36px; margin-bottom: 8px; opacity: 0.5; }
  .mp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 768px) { .mp-grid-2 { grid-template-columns: 1fr; } .mp-sider { width: 60px; } .mp-nav-text { display: none; } }
</style>
</head>
<body>
<div class="mp-shell">
  <aside class="mp-sider">
    <div class="mp-sider-brand">
      <div class="mp-sider-brand-logo">M</div>
      <div>
        <div class="mp-sider-brand-name">MetaPlatform</div>
        <div class="mp-sider-brand-sub">Admin · v6.0</div>
      </div>
    </div>
    <nav class="mp-sider-nav">
      <div class="mp-nav-group">概览</div>
      <a class="mp-nav-item ${activeNav === 'dashboard' ? 'active' : ''}" href="/"><i class="semi-icons semi-icon-home mp-nav-icon"></i><span class="mp-nav-text">Dashboard</span></a>
      <div class="mp-nav-group">Ontology</div>
      <a class="mp-nav-item ${activeNav === 'ontology' ? 'active' : ''}" href="/admin/ontology"><i class="semi-icons semi-icon-branch mp-nav-icon"></i><span class="mp-nav-text">本体</span></a>
      <a class="mp-nav-item ${activeNav === 'app-center' ? 'active' : ''}" href="/app-center"><i class="semi-icons semi-icon-grid mp-nav-icon"></i><span class="mp-nav-text">应用中心</span></a>
      <a class="mp-nav-item ${activeNav === 'presets' ? 'active' : ''}" href="/admin/presets"><i class="semi-icons semi-icon-package mp-nav-icon"></i><span class="mp-nav-text">Presets</span></a>
      <a class="mp-nav-item ${activeNav === 'installs' ? 'active' : ''}" href="/admin/installs"><i class="semi-icons semi-icon-download mp-nav-icon"></i><span class="mp-nav-text">Installs</span></a>
      <div class="mp-nav-group">运行</div>
      <a class="mp-nav-item ${activeNav === 'sandbox' ? 'active' : ''}" href="/admin/sandbox"><i class="semi-icons semi-icon-shield mp-nav-icon"></i><span class="mp-nav-text">mp-sandbox</span></a>
      <a class="mp-nav-item ${activeNav === 'sessions' ? 'active' : ''}" href="/admin/sessions"><i class="semi-icons semi-icon-robot mp-nav-icon"></i><span class="mp-nav-text">dsh Sessions</span></a>
      <div class="mp-nav-group">治理</div>
      <a class="mp-nav-item ${activeNav === 'hitl' ? 'active' : ''}" href="/admin/hitl"><i class="semi-icons semi-icon-handshake mp-nav-icon"></i><span class="mp-nav-text">HITL Hub</span></a>
      <a class="mp-nav-item ${activeNav === 'tenants' ? 'active' : ''}" href="/admin/tenants"><i class="semi-icons semi-icon-user mp-nav-icon"></i><span class="mp-nav-text">Tenants</span></a>
      <a class="mp-nav-item ${activeNav === 'audit' ? 'active' : ''}" href="/admin/audit"><i class="semi-icons semi-icon-file mp-nav-icon"></i><span class="mp-nav-text">Audit Log</span></a>
      <a class="mp-nav-item ${activeNav === 'cron' ? 'active' : ''}" href="/admin/cron"><i class="semi-icons semi-icon-clock mp-nav-icon"></i><span class="mp-nav-text">Cron Jobs</span></a>
      <a class="mp-nav-item ${activeNav === 'monitoring' ? 'active' : ''}" href="/admin/monitoring"><i class="semi-icons semi-icon-pulse mp-nav-icon"></i><span class="mp-nav-text">系统监控</span></a>
    </nav>
  </aside>
  <main class="mp-main">
    <header class="mp-header">
      <div class="mp-header-title">${title}</div>
      <div class="mp-header-meta">v6.0 · ${new Date().toLocaleString('zh-CN')}</div>
    </header>
    <div class="mp-content">
      ${body}
    </div>
    <footer class="mp-footer">MetaPlatform v6.0 · © ${new Date().getFullYear()} · ${activeNav === 'dashboard' ? 'Dashboard' : title}</footer>
  </main>
</div>
</body>
</html>`;
}

// 通用: statistic card
function stat(label, value, opts = {}) {
  const cls = opts.color ? ` ${opts.color}` : '';
  return `<div class="mp-stat-card">
    <div class="mp-stat-label">${label}</div>
    <div class="mp-stat-value${cls}">${value}</div>
    ${opts.trend ? `<div class="mp-stat-trend">${opts.trend}</div>` : ''}
  </div>`;
}

// 通用: card with title
function card(title, body, opts = {}) {
  return `<div class="mp-card">
    <div class="mp-card-title">${title}</div>
    ${body}
  </div>`;
}

// 通用: table from rows + cols (col = key or {key, label, render})
function table(rows, cols, opts = {}) {
  if (rows.length === 0) {
    return `<div class="mp-empty"><i class="semi-icons semi-icon-inbox mp-empty-icon"></i><div>${opts.empty || '暂无数据'}</div></div>`;
  }
  const headers = cols.map(c => typeof c === 'string' ? c : c.label || c.key);
  const cells = rows.map(r => '<tr>' + cols.map(c => {
    const key = typeof c === 'string' ? c : c.key;
    if (typeof c === 'object' && c.render) return `<td>${c.render(r[key], r)}</td>`;
    const v = r[key];
    if (v === null || v === undefined) return '<td>—</td>';
    return `<td>${escape(String(v))}</td>`;
  }).join('') + '</tr>').join('');
  return `<table class="mp-table">
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${cells}</tbody>
  </table>`;
}

// 通用: tag with color
function tag(text, color = 'grey') {
  return `<span class="mp-tag ${color}">${text}</span>`;
}

// 通用: breadcrumb
function breadcrumb(items) {
  return `<div class="mp-breadcrumb">` + items.map((it, i) => {
    const last = i === items.length - 1;
    return (i > 0 ? '<span class="mp-breadcrumb-sep">/</span>' : '') +
      (last ? `<span class="mp-breadcrumb-item" style="color:var(--semi-color-text-0)">${it}</span>`
            : `<a class="mp-breadcrumb-item" href="${it.href || '#'}" style="color:var(--semi-color-text-2);text-decoration:none">${it.text}</a>`);
  }).join('') + '</div>';
}

// HTML escape
function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/admin') {
      // Dashboard
      const [tenants, users, audits, installs, presets, cron, sessions, hitlPending, sigPending, sandboxExecs] = await Promise.all([
        c.query('SELECT count(*)::int AS n FROM public.tenants'),
        c.query('SELECT count(*)::int AS n FROM auth.users'),
        c.query("SELECT count(*)::int AS n FROM public.audit_log WHERE occurred_at > now() - interval '24 hours'"),
        c.query("SELECT count(*)::int AS n FROM mp_preset_registry.installs WHERE status = 'active'"),
        c.query('SELECT count(*)::int AS n FROM mp_preset_registry.presets'),
        c.query("SELECT count(*)::int AS n FROM cron.job WHERE active = true"),
        c.query("SELECT count(*)::int AS n FROM public.dsh_session_headers WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external')"),
        c.query("SELECT count(*)::int AS n FROM public.hitl_requests WHERE status = 'pending'"),
        c.query("SELECT count(*)::int AS n FROM public.workflow_signals WHERE status = 'pending'"),
        c.query("SELECT count(*)::int AS n FROM mp_sandbox.executions WHERE created_at > now() - interval '24 hours'"),
      ]);
      const body = `
        <div class="mp-stat-grid">
          ${stat('Tenants', tenants.rows[0].n, { color: 'primary', trend: '租户总数' })}
          ${stat('Auth Users', users.rows[0].n, { color: '', trend: '认证用户' })}
          ${stat('Audit (24h)', audits.rows[0].n, { color: 'success', trend: '近 24h 审计' })}
          ${stat('Active Installs', installs.rows[0].n, { color: 'primary', trend: '应用中心' })}
          ${stat('Presets', presets.rows[0].n, { color: '', trend: 'dsh preset' })}
          ${stat('Cron Jobs', cron.rows[0].n, { color: 'success', trend: 'pg_cron 活跃' })}
        </div>
        <div class="mp-stat-grid">
          ${stat('dsh Sessions (active)', sessions.rows[0].n, { color: 'primary', trend: 'M15 Postgres backend' })}
          ${stat('HITL Pending', hitlPending.rows[0].n, { color: hitlPending.rows[0].n > 0 ? 'warning' : '', trend: 'M13 4-type 联动中枢' })}
          ${stat('Workflow Signals (pending)', sigPending.rows[0].n, { color: 'warning', trend: 'M13 ↔ Temporal' })}
          ${stat('mp-sandbox (24h)', sandboxExecs.rows[0].n, { color: 'success', trend: 'Issue #15' })}
        </div>
        ${card('🚀 快速导航', `
          <div class="mp-grid-2">
            <div>
              <h4 style="margin:0 0 8px 0">核心引擎</h4>
              <a class="mp-nav-item" href="/admin/ontology">→ M11 Ontology Kernel</a>
              <a class="mp-nav-item" href="/admin/hitl">→ M13 HITL Hub</a>
              <a class="mp-nav-item" href="/admin/sessions">→ M15 dsh Sessions</a>
            </div>
            <div>
              <h4 style="margin:0 0 8px 0">数据 / 治理</h4>
              <a class="mp-nav-item" href="/app-center">→ 应用中心</a>
              <a class="mp-nav-item" href="/admin/presets">→ Presets</a>
              <a class="mp-nav-item" href="/admin/sandbox">→ mp-sandbox 执行</a>
              <a class="mp-nav-item" href="/admin/audit">→ Audit Log</a>
            </div>
          </div>
        `)}
      `;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'Dashboard', body, activeNav: 'dashboard' }));
    } else if (req.url === '/admin/tenants') {
      const r = await c.query("SELECT id, slug, name, status, created_at FROM public.tenants ORDER BY created_at DESC LIMIT 50");
      const body = card('Tenants', table(r.rows, ['id', 'slug', 'name', { key: 'status', label: '状态', render: v => tag(v, v === 'active' ? 'success' : 'grey') }, 'created_at']));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'Tenants', body, activeNav: 'tenants' }));
    } else if (req.url === '/admin/audit') {
      const r = await c.query("SELECT id, tenant_id, actor_id, action, schema_name, table_name, occurred_at FROM public.audit_log ORDER BY occurred_at DESC LIMIT 100");
      const body = card('Audit Log (latest 100)', table(r.rows, ['id', 'tenant_id', 'actor_id', 'action', 'schema_name', 'table_name', 'occurred_at']));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'Audit Log', body, activeNav: 'audit' }));
    } else if (req.url === '/admin/installs') {
      const r = await c.query("SELECT i.id, p.slug AS preset, i.workspace_id, i.status, i.installed_at FROM mp_preset_registry.installs i LEFT JOIN mp_preset_registry.presets p ON p.id = i.preset_id ORDER BY i.installed_at DESC LIMIT 50");
      const body = card('Installs', table(r.rows, ['id', 'preset', 'workspace_id', { key: 'status', label: '状态', render: v => tag(v, v === 'active' ? 'success' : 'grey') }, 'installed_at']));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'Installs', body, activeNav: 'installs' }));
    } else if (req.url === '/admin/presets') {
      const r = await c.query("SELECT slug, name, visibility, downloads_count, current_version, maintainer_id FROM mp_preset_registry.presets ORDER BY downloads_count DESC LIMIT 50");
      const body = card('Presets', table(r.rows, ['slug', 'name', { key: 'visibility', label: '可见性', render: v => tag(v, v === 'public' ? 'success' : 'grey') }, 'downloads_count', 'current_version', 'maintainer_id']));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'Presets', body, activeNav: 'presets' }));
    } else if (req.url === '/admin/cron') {
      const r = await c.query("SELECT jobname, schedule, active FROM cron.job ORDER BY jobname");
      const body = card('pg_cron Jobs', table(r.rows, ['jobname', 'schedule', { key: 'active', label: 'active', render: v => tag(v ? 'success' : 'grey', v ? 'success' : 'danger') }]));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'pg_cron Jobs', body, activeNav: 'cron' }));
    } else if (req.url === '/admin/sandbox') {
      const [stats, recent] = await Promise.all([
        c.query(`
          SELECT date_trunc('hour', created_at) AS hour,
                 count(*) FILTER (WHERE action = 'SANDBOX_EXECUTE')::int AS execute_count,
                 count(*) FILTER (WHERE action = 'SANDBOX_DENIED')::int AS denied_count,
                 count(*) FILTER (WHERE action = 'SANDBOX_TIMEOUT')::int AS timeout_count,
                 avg(duration_ms) FILTER (WHERE action = 'SANDBOX_EXECUTE')::int AS avg_duration_ms
          FROM mp_sandbox.executions
          WHERE created_at > now() - interval '24 hours'
          GROUP BY date_trunc('hour', created_at)
          ORDER BY hour DESC
          LIMIT 24`),
        c.query(`
          SELECT id, tenant_id, action, language, code_bytes, network, mode,
                 duration_ms, exit_code, created_at
          FROM mp_sandbox.executions
          ORDER BY created_at DESC LIMIT 50`),
      ]);
      const body = card('🛡️ mp-sandbox · 近 24h (按小时聚合)', table(stats.rows, ['hour', 'execute_count', 'denied_count', 'timeout_count', 'avg_duration_ms']))
        + card('最近 50 次执行', table(recent.rows, ['created_at', 'tenant_id', { key: 'action', label: 'action', render: v => tag(v, v === 'SANDBOX_DENIED' ? 'danger' : v === 'SANDBOX_TIMEOUT' ? 'warning' : 'success') }, 'language', 'mode', 'code_bytes', 'network', 'duration_ms', 'exit_code']));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'mp-sandbox 执行', body, activeNav: 'sandbox' }));
    } else if (req.url === '/admin/ontology') {
      const [objStats, relStats, actStats, recentObj, recentRel, recentAct] = await Promise.all([
        c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_object_types"),
        c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_relation_types"),
        c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_action_types"),
        c.query("SELECT rid, name, status, link_types, action_types, created_at FROM public.ontology_object_types ORDER BY created_at DESC LIMIT 10"),
        c.query("SELECT rid, name, from_type, to_type, cardinality, status, created_at FROM public.ontology_relation_types ORDER BY created_at DESC LIMIT 10"),
        c.query("SELECT rid, name, target_type, permission, workflow_name, hitl_type, status, created_at FROM public.ontology_action_types ORDER BY created_at DESC LIMIT 10"),
      ]);
      const o = objStats.rows[0], r = relStats.rows[0], a = actStats.rows[0];
      const body = `
        <div class="mp-stat-grid">
          ${stat('ObjectType (active)', o.active, { color: 'primary' })}
          ${stat('RelationType (active)', r.active, { color: 'primary' })}
          ${stat('ActionType (active)', a.active, { color: 'primary' })}
        </div>
        ${card('🧬 M11 Ontology Kernel · ObjectType (最近 10)', table(recentObj.rows, ['rid', 'name', { key: 'status', label: 'status', render: v => tag(v, v === 'active' ? 'success' : 'grey') }, 'link_types', 'action_types', 'created_at']))}
        ${card('RelationType (最近 10)', table(recentRel.rows, ['rid', 'name', 'from_type', 'to_type', 'cardinality', { key: 'status', label: 'status', render: v => tag(v, v === 'active' ? 'success' : 'grey') }, 'created_at']))}
        ${card('ActionType (最近 10)', table(recentAct.rows, ['rid', 'name', 'target_type', 'permission', 'workflow_name', 'hitl_type', { key: 'status', label: 'status', render: v => tag(v, v === 'active' ? 'success' : 'grey') }, 'created_at']))}
      `;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'M11 Ontology Kernel', body, activeNav: 'ontology' }));
    } else if (req.url === '/admin/hitl') {
      const [pending, decided24h, signals, recent] = await Promise.all([
        c.query("SELECT count(*)::int AS n FROM public.hitl_requests WHERE status = 'pending'"),
        c.query("SELECT count(*)::int AS n FROM public.hitl_requests WHERE status IN ('approved','rejected','expired','cancelled') AND decided_at > now() - interval '24 hours'"),
        c.query("SELECT status, count(*)::int AS n FROM public.workflow_signals GROUP BY status"),
        c.query("SELECT id, type, status, title, escalation_level, deadline_at, decided_at, created_at FROM public.hitl_requests ORDER BY created_at DESC LIMIT 20"),
      ]);
      const sigChips = signals.rows.map(s => tag(`${s.status}=${s.n}`, s.status === 'pending' ? 'warning' : s.status === 'failed' ? 'danger' : 'success')).join(' ');
      const body = `
        <div class="mp-stat-grid">
          ${stat('Pending', pending.rows[0].n, { color: pending.rows[0].n > 0 ? 'warning' : 'success' })}
          ${stat('Decided (24h)', decided24h.rows[0].n, { color: 'success' })}
        </div>
        ${card('⚖️ HITL Hub · 4 类型联动中枢', `<div>Workflow Signals: ${sigChips || '—'}</div>
          <div style="margin-top:8px; font-size:12px; color:var(--semi-color-text-2)">
            4 类型: workflow_saas (钉钉/飞书) · workflow_dsh (dsh Web) · tool_dsh (数字员工 tool 拦截) · action_confirm (ActionType.apply 预览). 升级: escalate-hitl EF · 自动 expire: pg_cron hitl-expire-overdue (*/5 * * * *).
          </div>`)}
        ${card('最近 HITL Request (20)', table(recent.rows, ['created_at', { key: 'type', label: 'type', render: v => tag(v, 'primary') }, { key: 'status', label: 'status', render: v => tag(v, v === 'pending' ? 'warning' : v === 'approved' ? 'success' : v === 'rejected' ? 'danger' : 'grey') }, 'escalation_level', 'title', 'deadline_at', 'decided_at']))}
      `;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'M13 HITL Hub', body, activeNav: 'hitl' }));
    } else if (req.url === '/admin/monitoring') {
      // M10 Loop 1/3: 调 mp-monitoring-health EF 显示 5 subsystem 状态
      const ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
      const SUPABASE_URL = 'http://127.0.0.1:54321';
      let health = null; let err = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/mp-monitoring-health`, {
          headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
        });
        if (r.ok) health = await r.json();
        else { err = `HTTP ${r.status}`; }
      } catch (e) { err = e.message; }

      let body;
      if (err) {
        body = card('⚠️ mp-monitoring-health 不可达', `<div style="color:var(--semi-color-danger)">${err}</div><p>EF 需在 /functions/v1 路由注册 (auto on supabase start). 等 5s 再刷新.</p>`);
      } else {
        const subs = health.subsystems || [];
        const subsTable = table(
          subs.map((s) => ({
            name: s.name,
            status: s.status,
            latency_ms: s.latency_ms,
            details: JSON.stringify(s.details || {}),
          })),
          [
            { key: 'name', label: 'subsystem' },
            { key: 'status', label: 'status', render: (v) => tag(v, v === 'healthy' ? 'success' : v === 'degraded' ? 'warning' : v === 'unhealthy' ? 'danger' : 'grey') },
            { key: 'latency_ms', label: 'latency (ms)' },
            { key: 'details', label: 'details' },
          ],
          { empty: '无 subsystem 数据' },
        );
        const s = health.summary || {};
        body = `
          <div class="mp-stat-grid">
            ${stat('Overall', health.overall, { color: health.overall === 'healthy' ? 'success' : health.overall === 'unhealthy' ? 'danger' : 'warning' })}
            ${stat('Total Latency', health.total_latency_ms + ' ms', { color: 'primary' })}
            ${stat('Healthy', s.healthy ?? 0, { color: 'success' })}
            ${stat('Degraded', s.degraded ?? 0, { color: 'warning' })}
            ${stat('Unhealthy', s.unhealthy ?? 0, { color: 'danger' })}
          </div>
          ${card('🩺 M10 mp-monitoring · subsystem 健康', subsTable)}
          ${card('说明', `<div style="font-size:12px; color:var(--semi-color-text-2)">5 subsystem: postgres (DB) · pg_cron (定时任务) · edge_functions (Deno) · realtime (publication) · mp_sandbox_sidecar (docker). PoC. Loop 2/3 接 OTel + Grafana. <br/>timestamp: <code>${health.timestamp}</code> · version: <code>${health.version}</code></div>`)}
        `;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'M10 系统监控', body, activeNav: 'monitoring' }));
    } else if (req.url === '/admin/sessions') {
      const [summary, activeByTenant, recent] = await Promise.all([
        c.query("SELECT active_count, completed_count, failed_count, last_active_at FROM public.dsh_session_summary ORDER BY last_active_at DESC NULLS LAST LIMIT 10"),
        c.query("SELECT tenant_id, count(*)::int AS active FROM public.dsh_session_headers WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external') GROUP BY tenant_id ORDER BY active DESC LIMIT 10"),
        c.query("SELECT id, tenant_id, agent_preset, status, version, updated_at, completed_at FROM public.dsh_session_headers ORDER BY updated_at DESC LIMIT 20"),
      ]);
      const summaryText = summary.rows.length > 0
        ? summary.rows.map(s => `tenant=${s.active_count + s.completed_count + s.failed_count} (active=${s.active_count}/done=${s.completed_count}/fail=${s.failed_count})`).join(' | ')
        : '尚无 session';
      const body = `
        <div class="mp-stat-grid">
          ${stat('总览', summaryText, { color: 'primary' })}
        </div>
        ${card('🤖 M15 dsh Session Postgres Backend · 活跃 session (per-tenant, top 10)', table(activeByTenant.rows, ['tenant_id', { key: 'active', label: 'active', render: v => tag(String(v), 'primary') }]))}
        ${card('最近 session (20)', table(recent.rows, ['updated_at', 'tenant_id', 'agent_preset', { key: 'status', label: 'status', render: v => tag(v, v === 'running' ? 'success' : v === 'failed' ? 'danger' : v === 'completed' ? 'primary' : 'grey') }, 'version', 'completed_at']))}
        ${card('EF (M15)', `<div style="font-size:12px; color:var(--semi-color-text-2)">
          dsh-session-create (POST 创建) · dsh-session-append-events (POST batch + seq contiguous 校验) · dsh-session-load (POST 重放).
          pg_cron dsh-session-cleanup: 每日 02:00 清理 completed/failed/cancelled 超 30 天.
        </div>`)}
      `;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: 'M15 dsh Sessions', body, activeNav: 'sessions' }));
    } else if (req.url === '/app-center') {
      const r = await c.query(
        "SELECT id, slug, name, category, visibility, current_version, downloads_count, maintainer_id FROM mp_preset_registry.presets ORDER BY category, downloads_count DESC"
      );
      const grouped = {};
      for (const row of r.rows) {
        const cat = row.category || 'uncategorized';
        (grouped[cat] = grouped[cat] || []).push(row);
      }
      const sections = Object.keys(grouped).sort().map(cat => card('📦 ' + cat + ' (' + grouped[cat].length + ')',
        table(grouped[cat], ['slug', 'name', 'current_version', 'downloads_count', { key: 'visibility', label: 'visibility', render: v => tag(v, v === 'public' ? 'success' : 'grey') }, 'maintainer_id'])));
      const body = card('📱 MetaPlatform 应用中心', `<div>共 <b>${r.rows.length}</b> 个 dsh 数字员工 preset</div>`) + sections.join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(layout({ title: '应用中心', body, activeNav: 'app-center' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + (err instanceof Error ? err.message : String(err)));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`MetaPlatform admin UI (Semi Design) on http://127.0.0.1:${port}`);
});