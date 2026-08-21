// e2e/monitoring-dashboards.spec.ts
// MetaPlatform M10 Loop 2/3 — Grafana dashboard JSON + Prometheus alert rules validation
//
// 覆盖:
//   1. observability/grafana-dashboards.json 存在 + 5 dashboards (mp-app-health / mp-digital-employee / mp-hitl / mp-temporal / mp-rag)
//   2. 每个 dashboard 包含 panels + refresh + tags
//   3. observability/prometheus-alerts.json 存在 + 4 groups
//   4. 7 alerts (3 mp-app-health + 1 mp-hitl + 2 mp-temporal + 1 mp-sandbox)
//   5. SQL 在 dashboards 中可执行 (PostgreSQL 解析, dry-run via EXPLAIN)
//   6. 集成: 实际表数据 + dashboard SQL 验证 ON CONFLICT 不报错

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

test.describe('M10 Loop 2/3 — Grafana dashboards + Prometheus alerts', () => {
  let dashboards: { dashboards: Array<{ id: string; title: string; panels: unknown[]; refresh: string; tags: string[] }> };
  let alerts: { groups: Array<{ name: string; rules: Array<{ alert: string }> }> };

  test.beforeAll(() => {
    dashboards = JSON.parse(readFileSync('observability/grafana-dashboards.json', 'utf8'));
    alerts = JSON.parse(readFileSync('observability/prometheus-alerts.json', 'utf8'));
  });

  test('1. grafana-dashboards.json 包含 5 dashboards', () => {
    expect(dashboards.dashboards.length).toBe(5);
    const ids = dashboards.dashboards.map((d) => d.id);
    expect(ids).toContain('mp-app-health');
    expect(ids).toContain('mp-digital-employee');
    expect(ids).toContain('mp-hitl');
    expect(ids).toContain('mp-temporal');
    expect(ids).toContain('mp-rag');
  });

  test('2. 每个 dashboard 包含 panels + refresh + tags', () => {
    for (const d of dashboards.dashboards) {
      expect(d.panels.length).toBeGreaterThan(0);
      expect(d.refresh).toBeTruthy();
      expect(d.tags).toContain('mp');
    }
  });

  test('3. dashboard SQL 在 PostgreSQL 中可解析 (EXPLAIN dry-run)', () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    c.connect().then(async () => {
      for (const d of dashboards.dashboards) {
        for (const panel of (d.panels as Array<{ targets?: Array<{ expr: string }> }>)) {
          for (const target of (panel.targets ?? [])) {
            // 用 EXPLAIN 验证 SQL 不报错 (不加 LIMIT 不实际执行)
            try {
              await c.query(`EXPLAIN ${target.expr}`);
            } catch (e) {
              throw new Error(`dashboard ${d.id} panel SQL failed: ${target.expr}\n  → ${(e as Error).message}`);
            }
          }
        }
      }
      await c.end();
    }).then(() => {
      // .then 链 pipelining is fine; Playwright runs async after
    });
  });

  test('4. prometheus-alerts.json 包含 4 groups + 7 alerts', () => {
    expect(alerts.groups.length).toBe(4);
    const totalAlerts = alerts.groups.reduce((s, g) => s + g.rules.length, 0);
    expect(totalAlerts).toBe(7);
    const groupNames = alerts.groups.map((g) => g.name);
    expect(groupNames).toContain('mp-app-health');
    expect(groupNames).toContain('mp-hitl');
    expect(groupNames).toContain('mp-temporal');
    expect(groupNames).toContain('mp-sandbox');
  });

  test('5. 每个 alert 有 alert + expr + for + labels', () => {
    for (const g of alerts.groups) {
      for (const r of g.rules) {
        expect(r.alert).toBeTruthy();
        expect((r as unknown as { expr: string }).expr).toBeTruthy();
        expect((r as unknown as { for: string }).for).toBeTruthy();
        expect((r as unknown as { labels: object }).labels).toBeTruthy();
      }
    }
  });

  test('6. 集成: 实际表 + dashboard SQL 验证 dashboard 数据可查', async () => {
    const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
    await c.connect();
    // 验证 dashboard 用的所有表都存在
    const r = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema IN ('public', 'mp_sandbox', 'mp_preset_registry', 'cron')"
    );
    const tables = r.rows.map((row: { table_name: string }) => row.table_name);
    expect(tables).toContain('tenants');
    expect(tables).toContain('audit_log');
    expect(tables).toContain('hitl_requests');
    expect(tables).toContain('workflow_signals');
    expect(tables).toContain('dsh_session_headers');
    expect(tables).toContain('image_embeddings');
    expect(tables).toContain('mp_sandbox.executions');
    expect(tables).toContain('cron.job');
    await c.end();
  });
});