// scripts/dev/admin-server.mjs
// MetaPlatform Ontology 本体平台 PoC
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
<meta charset="UTF-8"><title>Ontology 本体平台</title>
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
<header><h1>Ontology 本体平台 PoC</h1></header>
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
      c.query("SELECT count(*)::int AS n FROM public.audit_log WHERE occurred_at > now() - interval '24 hours'"),
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
          <li><a href="/admin/sandbox">🛡️ mp-sandbox 执行</a></li>
          <li><a href="/admin/ontology">🧬 Ontology Kernel</a></li>
          <li><a href="/admin/hitl">⚖️ HITL Hub</a></li>
          <li><a href="/admin/sessions">🤖 dsh Sessions</a></li>
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
  } else if (req.url === '/admin/sandbox') {
    // Issue #15 Loop 2/3: mp-sandbox executions UI (per-tenant stats + recent 50)
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
    const recentCols = ['created_at', 'action', 'language', 'mode', 'code_bytes', 'network', 'duration_ms', 'exit_code'];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(
      '<div class="card"><h2>🛡️ mp-sandbox 执行统计 (近 24h, 按小时聚合)</h2>' +
      renderTable(stats.rows, ['hour', 'execute_count', 'denied_count', 'timeout_count', 'avg_duration_ms']) +
      '</div>' +
      '<div class="card"><h2>最近 50 次执行</h2>' + renderTable(recent.rows, recentCols) + '</div>' +
      '<div class="card"><h2>说明</h2>' +
      '<p>数据来源: <code>mp_sandbox.executions</code> 表 (Issue #15 Loop 1/3 创建). audit_log 由 tg_audit 触发器自动写入 (Loop 2/3 删 RPC).</p>' +
      '<ul><li><a href="/admin">← 返回 Dashboard</a></li></ul></div>'
    ));
  } else if (req.url === '/admin/ontology') {
    // Loop K: M11 Ontology Kernel dashboard — 3 表统计 + 最近创建
    const [objStats, relStats, actStats, recentObj, recentRel, recentAct] = await Promise.all([
      c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_object_types"),
      c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_relation_types"),
      c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM public.ontology_action_types"),
      c.query("SELECT rid, name, status, link_types, action_types, created_at FROM public.ontology_object_types ORDER BY created_at DESC LIMIT 10"),
      c.query("SELECT rid, name, from_type, to_type, cardinality, status, created_at FROM public.ontology_relation_types ORDER BY created_at DESC LIMIT 10"),
      c.query("SELECT rid, name, target_type, permission, workflow_name, hitl_type, status, created_at FROM public.ontology_action_types ORDER BY created_at DESC LIMIT 10"),
    ]);
    const o = objStats.rows[0];
    const r = relStats.rows[0];
    const a = actStats.rows[0];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(
      '<div class="card"><h2>🧬 M11 Ontology Kernel — 3 类型统计</h2>' +
      '<p>ObjectType: <b>' + o.active + '</b> active / ' + o.total + ' total &nbsp; ' +
      'RelationType: <b>' + r.active + '</b> active / ' + r.total + ' total &nbsp; ' +
      'ActionType: <b>' + a.active + '</b> active / ' + a.total + ' total</p>' +
      '</div>' +
      '<div class="card"><h2>最近 ObjectType (10)</h2>' + renderTable(recentObj.rows, ['rid', 'name', 'status', 'link_types', 'action_types', 'created_at']) + '</div>' +
      '<div class="card"><h2>最近 RelationType (10)</h2>' + renderTable(recentRel.rows, ['rid', 'name', 'from_type', 'to_type', 'cardinality', 'status', 'created_at']) + '</div>' +
      '<div class="card"><h2>最近 ActionType (10)</h2>' + renderTable(recentAct.rows, ['rid', 'name', 'target_type', 'permission', 'workflow_name', 'hitl_type', 'status', 'created_at']) + '</div>' +
      '<div class="card"><h2>说明</h2>' +
      '<p>数据来源: <code>public.ontology_*</code> 表 (Loop 1/3+2/3 创建). CRUD EF: list-ontology-types / get-ontology-type / create-ontology-type.</p>' +
      '<ul><li><a href="/admin">← 返回 Dashboard</a></li></ul></div>'
    ));
  } else if (req.url === '/admin/hitl') {
    // Loop K: HITL Hub dashboard — pending + 最近决策 + workflow_signals 队列
    const [pending, decided, signals, recent] = await Promise.all([
      c.query("SELECT count(*)::int AS n FROM public.hitl_requests WHERE status = 'pending'"),
      c.query("SELECT count(*)::int AS n FROM public.hitl_requests WHERE status IN ('approved','rejected','expired','cancelled') AND decided_at > now() - interval '24 hours'"),
      c.query("SELECT status, count(*)::int AS n FROM public.workflow_signals GROUP BY status"),
      c.query("SELECT id, type, status, title, escalation_level, deadline_at, decided_at, created_at FROM public.hitl_requests ORDER BY created_at DESC LIMIT 20"),
    ]);
    const sigs = signals.rows;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(
      '<div class="card"><h2>⚖️ HITL Hub — 4 类型联动中枢</h2>' +
      '<p>Pending: <b>' + pending.rows[0].n + '</b> &nbsp; ' +
      'Decided (近 24h): <b>' + decided.rows[0].n + '</b> &nbsp; ' +
      'Workflow Signals: ' + sigs.map(s => s.status + '=' + s.n).join(' / ') + '</p>' +
      '</div>' +
      '<div class="card"><h2>最近 HITL Request (20)</h2>' + renderTable(recent.rows, ['created_at', 'type', 'status', 'escalation_level', 'title', 'deadline_at', 'decided_at']) + '</div>' +
      '<div class="card"><h2>说明</h2>' +
      '<p>数据来源: <code>public.hitl_requests</code> + <code>public.workflow_signals</code> (Loop 1/3+2/3 创建). 4 类型: workflow_saas / workflow_dsh / tool_dsh / action_confirm.</p>' +
      '<p>多级审批: escalate-hitl EF (level+1, deadline 阶梯 24h*level). expire-overdue-hitl EF (pg_cron */5 * * * *).</p>' +
      '<ul><li><a href="/admin">← 返回 Dashboard</a></li></ul></div>'
    ));
  } else if (req.url === '/admin/sessions') {
    // Loop K: M15 dsh session Postgres backend dashboard
    const [summary, active, recent] = await Promise.all([
      c.query("SELECT active_count, completed_count, failed_count, last_active_at FROM public.dsh_session_summary ORDER BY last_active_at DESC NULLS LAST LIMIT 10"),
      c.query("SELECT tenant_id, count(*)::int AS active FROM public.dsh_session_headers WHERE status IN ('running','waiting_tool','waiting_hitl','waiting_external') GROUP BY tenant_id ORDER BY active DESC LIMIT 10"),
      c.query("SELECT id, tenant_id, agent_preset, status, version, updated_at, completed_at FROM public.dsh_session_headers ORDER BY updated_at DESC LIMIT 20"),
    ]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(
      '<div class="card"><h2>🤖 M15 dsh Session Postgres Backend (K8s 多副本共享)</h2>' +
      '<p>总览 (per-tenant): ' + summary.rows.map(s => 'active=' + s.active_count + '/done=' + s.completed_count + '/fail=' + s.failed_count).join(' | ') + '</p>' +
      '</div>' +
      '<div class="card"><h2>活跃 session (per-tenant, 10)</h2>' + renderTable(active.rows, ['tenant_id', 'active']) + '</div>' +
      '<div class="card"><h2>最近 session (20)</h2>' + renderTable(recent.rows, ['updated_at', 'tenant_id', 'agent_preset', 'status', 'version', 'completed_at']) + '</div>' +
      '<div class="card"><h2>说明</h2>' +
      '<p>数据来源: <code>public.dsh_session_headers</code> + <code>public.dsh_session_events</code> (M15 ADR-0055).</p>' +
      '<p>EF: dsh-session-create / dsh-session-append-events (seq contiguous 校验) / dsh-session-load (按 seq 顺序重放).</p>' +
      '<p>pg_cron dsh-session-cleanup: 每日 02:00 清理 completed/failed/cancelled 超 30 天的 session.</p>' +
      '<ul><li><a href="/admin">← 返回 Dashboard</a></li></ul></div>'
    ));
  } else if (req.url === '/app-center') {
    // App Center: list of all published presets (public + private), grouped by category.
    // Reuses the public.mp_preset_registry tables seeded by 20260820300000 migration.
    const r = await c.query(
      "SELECT id, slug, name, category, visibility, current_version, downloads_count, maintainer_id FROM mp_preset_registry.presets ORDER BY category, downloads_count DESC"
    );
    const grouped = {};
    for (const row of r.rows) {
      const cat = row.category || 'uncategorized';
      (grouped[cat] = grouped[cat] || []).push(row);
    }
    const sections = Object.keys(grouped).sort().map(cat => {
      const rows = grouped[cat].map(row => `
        <tr>
          <td><code>${row.slug}</code></td>
          <td>${row.name}</td>
          <td>${row.current_version ?? '—'}</td>
          <td>${row.downloads_count}</td>
          <td><span class="badge ${row.visibility === 'public' ? 'badge-green' : 'badge-blue'}">${row.visibility}</span></td>
          <td>${row.maintainer_id ?? '—'}</td>
        </tr>`).join('');
      return card('📦 ' + cat + ' (' + grouped[cat].length + ')',
        renderTable(grouped[cat], ['slug', 'name', 'current_version', 'downloads_count', 'visibility', 'maintainer_id'])
          .replace(/<tr>/, '<tr>')
          .replace(/<th>N<\/th>/, '<th>v</th>')
      );
    }).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(
      '<div class="card"><h2>📱 MetaPlatform 应用中心</h2>' +
      '<p>共 ' + r.rows.length + ' 个 dsh 数字员工 preset. 点击 <code>slug</code> 可在未来版本跳到 install / config 流程.</p></div>' +
      sections
    ));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Ontology 本体平台 admin server on http://127.0.0.1:' + port);
});
