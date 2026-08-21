# PRD：mp-data-product（数据产品）

> **应用**：mp-data-product — 数据产品化（指标 / 报表 / API）
> **类别**：5. 数据产品
> **对应 namespace**：mp-data
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-data-product` 把 v6.0 的数据**产品化**给业务用户：指标定义、报表生成、数据 API。

## 2. 核心功能

- 指标定义（YAML / DSL）：基础指标 / 派生指标 / 复合指标
- 报表（拖拽式配置）
- 数据 API（按指标开放）
- 指标血缘（追溯数据来源）
- 定时刷新 + 缓存

## 3. 关键接口

```typescript
// 注册指标
POST /v1/data-products/metrics
{
  "name": "monthly_active_users",
  "definition": {
    "type": "count_distinct",
    "table": "auth.users",
    "filter": "last_login_at > now() - interval '30 days'"
  }
}

// 查询指标
GET /v1/data-products/metrics/mau?tenant_id=...&from=2026-01-01&to=2026-08-20

// 数据 API（自动生成）
GET /api/v1/metrics/{metric_name}
```

## 4. 数据模型

```sql
CREATE TABLE mp_data_product.metrics (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    display_name text NOT NULL,
    definition   jsonb NOT NULL,
    refresh_cron text,                                -- e.g. '0 1 * * *'
    cache_ttl_seconds int NOT NULL DEFAULT 3600,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE mp_data_product.dashboards (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    layout       jsonb NOT NULL,                       -- 仪表盘配置
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mp_data_product.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/data-product:v6.0.0-<sha>`
- 副本：HPA 2-8
- 资源：CPU 1 / Memory 2Gi
- 入口：`api.mp-platform.local/data-product/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 注册 + 查询一个指标跑通 |
| AC2 | 派生指标（MAU = sum(dau last 30 days)）|
| AC3 | 仪表盘拖拽式配置 |
| AC4 | 数据 API 自动生成 + 缓存 |
| AC5 | 指标血缘可视化 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| [mp-data-platform](mp-data-platform.md) | 自家 |
| Supabase PG | MetaPlatform-FOUNDATION-01 |

## 8. 不做

- ❌ OLAP 引擎（v6.0 用 PG，ClickHouse v6.1 评估）
- ❌ 自研 BI 工具（接 Metabase / Superset）
- ❌ 实时大屏（v6.0 准实时，秒级延迟）
- ❌ 数据科学平台（v7.0 讨论）

---

*PRD v1.0 — 配套 [mp-data-platform](mp-data-platform.md) / [mp-data-quality](mp-data-quality.md)*