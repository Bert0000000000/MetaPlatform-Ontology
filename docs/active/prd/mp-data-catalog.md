# PRD：mp-data-catalog（数据目录）

> **应用**：mp-data-catalog — 数据资产目录
> **类别**：5. 数据产品
> **对应 namespace**：mp-data
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-data-catalog` 是 v6.0 的**数据资产目录**：所有表 / 指标 / 报表的元数据 + 搜索 + 文档。

## 2. 核心功能

- 自动发现（PG schema scan）
- 元数据管理（表 / 列描述 / 标签 / Owner）
- 全文搜索（表名 / 列名 / 描述）
- 数据血缘（跨表 / 跨应用）
- 标签分类（PII / 公开 / 内部）
- 影响分析（"改这张表会影响哪些应用"）

## 3. 关键接口

```typescript
// 搜索
GET /v1/data-catalog/search?q=orders&type=table

// 表详情
GET /v1/data-catalog/tables/public.orders
// → { columns, owner, lineage, tags, ... }

// 添加标签
POST /v1/data-catalog/tables/:id/tags
{ "tags": ["pii", "financial"] }

// 影响分析
GET /v1/data-catalog/tables/public.orders/impact
// → { downstream: ["orders",", "reports.revenue"], affected_apps: [...] }
```

## 4. 数据模型

```sql
CREATE TABLE mp_data_catalog.tables (
    id           uuid PRIMARY KEY,
    tenant_id    uuid,                                -- NULL = 全局表
    schema_name  text NOT NULL,
    table_name   text NOT NULL,
    description  text,
    owner_id     uuid,
    tags         text[] NOT NULL DEFAULT '{}',
    last_scanned timestamptz,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, schema_name, table_name)
);

CREATE TABLE mp_data_catalog.columns (
    id           uuid PRIMARY KEY,
    table_id     uuid NOT NULL REFERENCES mp_data_catalog.tables(id) ON DELETE CASCADE,
    column_name  text NOT NULL,
    data_type    text NOT NULL,
    description  text,
    is_pii       boolean NOT NULL DEFAULT false,
    UNIQUE (table_id, column_name)
);

CREATE TABLE mp_data_catalog.lineage (
    id           uuid PRIMARY KEY,
    from_table   text NOT NULL,                       -- 'schema.table'
    to_table     text NOT NULL,
    transformation text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mp_data_catalog.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/data-catalog:v6.0.0-<sha>`
- 副本：HPA 2-5
- 资源：CPU 500m / Memory 1Gi
- 入口：`api.mp-platform.local/data-catalog/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 自动扫描 PG schema |
| AC2 | 全文搜索（中文）|
| AC3 | 标签管理 |
| AC4 | 数据血缘可视化（dag）|
| AC5 | 影响分析 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MP-V6-FOUNDATION-01 |
| [mp-data-platform](mp-data-platform.md) | 自家（血缘数据源）|

## 8. 不做

- ❌ 跨数据源目录（v6.0 仅 PG）
- ❌ 自动打 PII 标签（v6.1 引入 AI 识别）
- ❌ 数据访问请求 / 审批（v6.1 引入）
- ❌ 与外部 catalog（如 DataHub）联动

---

*PRD v1.0 — 配套 [mp-data-platform](mp-data-platform.md) / [mp-data-product](mp-data-product.md) / [mp-data-quality](mp-data-quality.md)*