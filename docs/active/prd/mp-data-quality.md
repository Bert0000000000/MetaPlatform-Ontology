# PRD：mp-data-quality（数据质量）

> **应用**：mp-data-quality — 数据质量监控 + 校验
> **类别**：5. 数据产品
> **对应 namespace**：mp-data
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-data-quality` 提供**数据质量监控**能力：规则定义、自动校验、异常告警。

## 2. 核心功能

- 6 类规则：完整性 / 唯一性 / 准确性 / 一致性 / 时效性 / 有效性
- 自动定时校验
- 异常告警（Slack / 邮件）
- 数据画像（profile）
- 修复建议（可选自动修复）

## 3. 关键接口

```typescript
// 定义规则
POST /v1/data-quality/rules
{
  "name": "orders-no-null-amount",
  "table": "public.orders",
  "type": "completeness",
  "column": "amount",
  "check": "amount IS NOT NULL",
  "threshold": 0.99,                    -- 99% 数据满足
  "schedule": "0 * * * *"
}

// 查询规则状态
GET /v1/data-quality/rules/:id
// → { status: 'passing' | 'failing', last_checked, pass_rate, ... }

// 触发手动校验
POST /v1/data-quality/rules/:id/run
```

## 4. 数据模型

```sql
CREATE TABLE mp_data_quality.rules (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    name         text NOT NULL,
    table_name   text NOT NULL,
    type         text NOT NULL,                       -- completeness / uniqueness / ...
    check_expr   text NOT NULL,
    threshold    numeric(5,4) NOT NULL DEFAULT 1.0,
    schedule     text,
    enabled      boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_data_quality.runs (
    id              bigserial PRIMARY KEY,
    rule_id         uuid NOT NULL REFERENCES mp_data_quality.rules(id) ON DELETE CASCADE,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL,                    -- passing / failing / error
    pass_rate       numeric(5,4),
    total_rows      bigint,
    failed_rows     bigint,
    sample_failures jsonb
);

ALTER TABLE mp_data_quality.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/data-quality:v6.0.0-<sha>`
- 副本：HPA 2-5
- 资源：CPU 500m / Memory 1Gi
- 入口：`api.mp-platform.local/data-quality/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 定义 6 类规则 + 自动跑 |
| AC2 | 异常告警（Slack / 邮件）|
| AC3 | 数据画像可视化 |
| AC4 | 修复建议 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MP-V6-FOUNDATION-01 |
| Slack / 邮件 webhook | 用户 |

## 8. 不做

- ❌ 自研规则引擎（用 SQL 表达式）
- ❌ 自动修复（v6.1 引入）
- ❌ 跨数据源规则（v6.0 仅 PG）

---

*PRD v1.0 — 配套 [mp-data-platform](mp-data-platform.md) / [otel-collector-config](otel-collector-config.md)*