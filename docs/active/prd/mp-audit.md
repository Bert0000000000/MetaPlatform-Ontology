# PRD：mp-audit（审计与合规）

> **应用**：mp-audit — 审计日志聚合 + 合规报表
> **类别**：6. 可观测
> **对应 namespace**：mp-monitoring
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-audit` 聚合全平台审计日志（来自 [foundation-supabase-schema](foundation-supabase-schema.md) 的 `public.audit_log`），提供查询、分析、合规报表。

## 2. 核心功能

- 审计日志统一查询（跨应用 / 跨租户 for SRE）
- 异常行为检测（暴力登录 / 越权访问）
- 合规报表（GDPR / 个保法 / SOC2）
- 7 年保留 + 不可篡改（合规）
- 数据导出（CSV / JSON）

## 3. 关键接口

```typescript
// 高级查询
POST /v1/audit/search
{
  "tenant_id": "...",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-08-20T23:59:59Z",
  "actor_id": "...",
  "action": "INSERT",
  "table_name": "orders",
  "limit": 1000
}

// 异常检测报告
GET /v1/audit/anomalies?tenant_id=...&from=...&to=...

// 导出
POST /v1/audit/export
{ "query": {...}, "format": "csv" }
// → { download_url, expires_at }
```

## 4. 数据模型

```sql
-- 复用 public.audit_log（来自 foundation-supabase-schema）
-- 本服务只做查询 + 聚合

-- 异常检测结果
CREATE TABLE mp_audit.anomalies (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    anomaly_type text NOT NULL,                      -- brute_force_login / unauthorized_access / ...
    severity     text NOT NULL,                      -- low / medium / high / critical
    actor_id     uuid,
    description  text NOT NULL,
    evidence     jsonb NOT NULL,
    detected_at  timestamptz NOT NULL DEFAULT now(),
    reviewed_at  timestamptz,
    reviewer_id  uuid,
    status       text NOT NULL DEFAULT 'new'         -- new / reviewed / dismissed
);

CREATE TABLE mp_audit.compliance_reports (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    framework    text NOT NULL,                      -- gdpr / soc2 / mlps
    period_start timestamptz NOT NULL,
    period_end   timestamptz NOT NULL,
    report_url   text NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mp_audit.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/audit:v6.0.0-<sha>`
- 副本：HPA 2-5
- 资源：CPU 500m / Memory 1Gi
- 入口：`api.mp-platform.local/audit/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 跨应用审计日志查询 |
| AC2 | 异常检测（至少 3 类：暴力登录 / 越权 / 异常删除）|
| AC3 | GDPR 合规报表 |
| AC4 | 数据导出 + 下载链接（带过期时间）|
| AC5 | SRE 角色可见全平台；普通用户只能看自己 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase audit_log | [foundation-supabase-schema](foundation-supabase-schema.md) |
| S3 / OSS（合规报表归档）| [foundation-dr-backup](foundation-dr-backup.md) |

## 8. 不做

- ❌ 实时告警（v6.0 仅日报；实时告警由 [mp-monitoring](mp-monitoring.md)）
- ❌ 行为分析（v6.1 引入）
- ❌ 第三方 SIEM 集成（v6.1）

---

*PRD v1.0 — 配套 [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-dr-backup](foundation-dr-backup.md)*