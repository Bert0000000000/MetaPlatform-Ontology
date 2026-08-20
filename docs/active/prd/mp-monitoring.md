# PRD：mp-monitoring（基础设施监控）

> **应用**：mp-monitoring — 基础设施监控（独立于应用层 OTel）
> **类别**：6. 可观测
> **对应 namespace**：mp-monitoring
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-monitoring` 提供 v6.0 的**基础设施层监控**（K8s 资源 / 网络 / 存储），与 [otel-collector-config](otel-collector-config.md) 配合：OTel 负责应用层，mp-monitoring 负责基础设施层。

## 2. 核心功能

- K8s 节点 / Pod 资源监控（CPU / 内存 / 网络 / 磁盘）
- Node exporter + kube-state-metrics
- 告警规则（节点故障 / 资源耗尽 / 副本异常）
- 自定义告警规则管理

## 3. 关键接口

```typescript
// 自定义告警规则
POST /v1/monitoring/alert-rules
{
  "name": "high-cpu-usage",
  "expr": "node_cpu_utilization > 0.9",
  "for": "5m",
  "severity": "critical",
  "channels": ["slack", "pagerduty"]
}

// 查询当前告警
GET /v1/monitoring/alerts?severity=critical

// 健康检查聚合
GET /v1/monitoring/health
// → { k8s: 'healthy', db: 'healthy', cache: 'healthy', ... }
```

## 4. 数据模型

```sql
CREATE TABLE mp_monitoring.alert_rules (
    id           uuid PRIMARY KEY,
    tenant_id    uuid,
    name         text NOT NULL,
    expr         text NOT NULL,                      -- PromQL 表达式
    severity      text NOT NULL,
    channels     text[] NOT NULL DEFAULT '{}',
    enabled      boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_monitoring.alert_history (
    id           bigserial PRIMARY KEY,
    rule_id      uuid REFERENCES mp_monitoring.alert_rules(id),
    fired_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz,
    severity     text NOT NULL,
    labels       jsonb
);

ALTER TABLE mp_monitoring.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- node-exporter / kube-state-metrics：DaemonSet
- 告警 API：Deployment（2 副本）
- 资源：CPU 200m / Memory 256Mi（API 层）
- 入口：`api.mp-platform.local/monitoring/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 节点 CPU / 内存 / 磁盘 / 网络采集 |
| AC2 | 自定义告警规则生效 |
| AC3 | 告警通道（Slack / PagerDuty / 邮件）|
| AC4 | 健康检查聚合 API |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Prometheus | [otel-collector-config](otel-collector-config.md) |
| kube-state-metrics | 标准 K8s 组件 |

## 8. 不做

- ❌ 应用层监控（由 OTel 负责）
- ❌ 日志聚合（由 Loki 负责）
- ❌ 自研时序数据库（用 Prometheus）

---

*PRD v1.0 — 配套 [otel-collector-config](otel-collector-config.md) / [mp-audit](mp-audit.md)*