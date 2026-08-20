# PRD：mp-data-platform（数据平台）

> **应用**：mp-data-platform — 数据平台（基础数据接入 + 数据质量 + 编排）
> **类别**：5. 数据产品
> **对应 namespace**：mp-data
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-data-platform` 是 v6.0 的**数据接入与编排平台**，提供：
- 数据源接入（Postgres / MySQL / API / S3）
- 数据管道编排（DAG）
- 数据入仓（Supabase PG）
- 数据血缘追踪

## 2. 核心功能

- 连接器管理（数据源 / 目标）
- 数据管道（DAG 编排）
- 增量同步 / 全量同步
- Schema 演进（自动跟随）
- 失败重试 + 告警
- 血缘追踪
- 定时 / 事件触发

## 3. 关键接口

```typescript
// 注册数据源
POST /v1/data/sources
{
  "name": "v3-orders",
  "type": "postgres",
  "connection": { "host": "...", "port": 5432, ... },
  "schema_mapping": "..."
}

// 创建管道
POST /v1/data/pipelines
{
  "name": "orders-to-supabase",
  "source_id": "...",
  "destination": "public.orders",
  "schedule": "0 2 * * *",
  "mode": "incremental"
}

// 查询管道状态
GET /v1/data/pipelines/:id
```

## 4. 数据模型

```sql
CREATE TABLE mp_data_platform.sources (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    type         text NOT NULL,                       -- postgres / mysql / api / s3
    config_encrypted bytea NOT NULL,                  -- KMS 加密连接信息
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_data_platform.pipelines (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    source_id    uuid NOT NULL REFERENCES mp_data_platform.sources(id),
    destination  text NOT NULL,                       -- 'public.orders'
    schedule     text,                                -- cron 表达式
    mode         text NOT NULL DEFAULT 'incremental',  -- incremental / full
    state        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- last_watermark 等
    status       text NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_data_platform.runs (
    id              bigserial PRIMARY KEY,
    pipeline_id     uuid NOT NULL REFERENCES mp_data_platform.pipelines(id),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL,                     -- running / success / failed
    rows_processed  bigint,
    error_message   text
);

ALTER TABLE mp_data_platform.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/data-platform:v6.0.0-<sha>`
- 副本：HPA 2-10
- 资源：CPU 1 / Memory 2Gi
- 入口：`api.mp-platform.local/data-platform/v1`
- Worker：K8s Job（按需调度）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 注册 Postgres / MySQL / API / S3 四类数据源 |
| AC2 | 创建 pipeline + 定时跑通 |
| AC3 | 增量同步（基于 watermark）|
| AC4 | Schema 演进自动跟随 |
| AC5 | 失败重试 + 告警 |
| AC6 | 血缘追踪可视化 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MP-V6-FOUNDATION-01 |
| [foundation-dr-backup](foundation-dr-backup.md) | MP-V6-FOUNDATION-01 |

## 8. 不做

- ❌ 自研 ETL 引擎（用现成工具如 Airbyte / Meltano，v6.0 评估）
- ❌ 数据湖（v6.1 引入）
- ❌ 实时流处理（v6.0 仅批处理 + 准实时）
- ❌ 大数据 Hadoop 栈

---

*PRD v1.0 — 配套 [mp-data-product](mp-data-product.md) / [mp-data-quality](mp-data-quality.md) / [etl-export-v3](etl-export-v3.md)*