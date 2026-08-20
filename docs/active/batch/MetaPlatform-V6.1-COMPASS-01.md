# MetaPlatform.1-COMPASS-01 — v6.1 Compass 业务智能

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 v6.1 must（业务驱动）
> **工作量**：8 周
> **团队**：AI 团队 + 后端
> **前置依赖**：MetaPlatform-DSH-01 ✅

---

## 1. 目标

实现 v6.1 Compass 业务智能仪表盘：dsh `dashboard-curator` preset（NL→SQL + 图表）+ Materialized View（业务 KPI 聚合）+ 自助 dashboard 系统。

## 2. 配套文档

- v6.1 路线图：[docs/active/v6.1-roadmap.md](../v6.1-roadmap.md) §must v6.1
- ADR-0061：[docs/active/decisions/ADR-0061-v6.1-compass.md](../decisions/ADR-0061-v6.1-compass.md)
- mp-data-product PRD：[docs/active/prd/mp-data-product.md](../prd/mp-data-product.md)

## 3. 核心交付

| 项 | 验证 |
|---|---|
| dsh `dashboard-curator` preset | cordis.yml + 8 工具 |
| `dashboards` 表 (布局 + 共享) | ddl |
| `dashboard_widgets` 表 (5 类) | ddl |
| Materialized View `mv_order_kpi_daily` | ddl + refresh cron |
| pg_cron `compass-mv-refresh` 每日 1 点 | SQL |
| HITL 集成 (复杂查询需 admin 批) | dsh integration |
| E2E test | compass.spec.ts |
| evidence | `evidence/MetaPlatform.1-COMPASS-01-ACCEPTANCE.md` |

## 4. 验收标准（AC）

- [x] dsh preset 配置完成
- [x] 仪表盘 CRUD + RLS
- [x] Materialized View 聚合数据
- [x] pg_cron 自动刷新
- [x] dsh NL→SQL 工作流
- [x] E2E 测试
- [x] evidence 完成

## 5. 风险

| 风险 | 缓解 |
|---|---|
| NL→SQL 注入 | dsh sandbox + LLM 只读 SELECT |
| MV 刷新慢 | CONCURRENTLY 不阻塞查询 |
| Dashboard 误配置 | layout JSONB schema 校验 |

---

*MetaPlatform.1-COMPASS-01 — v6.1 Compass 业务仪表盘*