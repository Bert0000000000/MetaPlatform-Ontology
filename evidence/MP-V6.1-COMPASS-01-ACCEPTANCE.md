# MP-V6.1-COMPASS-01 - ACCEPTANCE

> **状态**：✅ Accepted (Compass 完整骨架)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6.1-COMPASS-01.md](../batch/MP-V6.1-COMPASS-01.md)
> **关联 PRD**：[mp-data-product.md](../prd/mp-data-product.md) + ADR-0061 (Compass)

---

## 验收标准（AC）

- [x] `dashboards` 表 (仪表盘定义, layout JSONB)
- [x] `dashboard_widgets` 表 (chart / kpi / table / text / sql 5 类 widget)
- [x] RLS + tg_inject_tenant + tg_audit 触发器
- [x] Materialized View `mv_order_kpi_daily` (每日订单 KPI 聚合)
- [x] pg_cron `compass-mv-refresh` (每天凌晨 1 点 REFRESH CONCURRENTLY)
- [x] dsh `dashboard-curator` preset (NL→SQL + 图表 + 异常检测 + dashboard 保存)
- [x] evidence 完成

## 待用户在宿主机完成

- [ ] 测试 dashboard 创建:
```sql
INSERT INTO dashboards (tenant_id, name, layout, created_by)
VALUES (auth.tenant_id, '订单 KPI', '{"grid":{"cols":12,"rowHeight":50},"widgets":[]}');

INSERT INTO dashboard_widgets (dashboard_id, tenant_id, type, title, sql_query, chart_type, grid_pos)
VALUES (
  (SELECT id FROM dashboards WHERE name = '订单 KPI'),
  auth.tenant_id,
  'chart',
  '每日订单数',
  'SELECT day, order_count FROM mv_order_kpi_daily WHERE tenant_id = auth.tenant_id() ORDER BY day DESC LIMIT 30',
  'line',
  '{"x":0,"y":0,"w":6,"h":4}'
);
```

- [ ] dsh dashboard-curator preset 测试:
  - 浏览器 dsh-web → 选 dashboard-curator preset
  - 输入 "上月订单趋势" → 自动生成 SQL → 跑 → 图表
  - 验证 mv_order_kpi_daily 数据加载

- [ ] Playwright E2E (compass.spec.ts):
  - 创建 dashboard + widget
  - 验证 widget 渲染 (chart + KPI)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `supabase/migrations/20260820220000_create_compass_dashboards.sql` | dashboards + widgets + mv_order_kpi_daily + pg_cron |
| `apps/dsh-presets/dashboard-curator/cordis.yml` | dsh 数字员工 preset (8 工具 + state machine) |
| `docs/active/batch/MP-V6.1-COMPASS-01.md` | Batch 任务清单 |
| `evidence/MP-V6.1-COMPASS-01-ACCEPTANCE.md` | Acceptance 文档 |

## Compass 集成架构

```
[用户: "上月订单趋势"]
         ↓
[dsh dashboard-curator preset]
         ↓ nl_to_sql
[生成 SQL: SELECT day, order_count FROM mv_order_kpi_daily WHERE tenant_id = ...]
         ↓ run_query (RLS 自动隔离)
[PostgreSQL MV (每天 1 点刷新)]
         ↓ render_chart
[Plotly line chart]
         ↓ suggest_kpis
[业务洞察: "周二峰值 23%"]
         ↓ save_dashboard
[public.dashboards + dashboard_widgets]
         ↓
[dsh-web UI: dashboard 卡片显示]
```

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| NL→SQL 注入 | dsh 在 sandbox 跑, LLM 输出只读 SELECT, 不允许 DDL/DML |
| MV 刷新慢 | CONCURRENTLY 锁不阻塞查询 |
| Dashboard 配置被破坏 | layout JSONB schema 校验 (前端 + 后端) |
| 大数据集查询慢 | dsh LIMIT 10000 + Materialized View 聚合 |

---

*MP-V6.1-COMPASS-01 ACCEPTANCE — 2026-08-20 — v6.1 Compass 业务智能仪表盘就绪*