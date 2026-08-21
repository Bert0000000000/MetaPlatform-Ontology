# PRD：mp-frontend-obs（前端可观测）

> **应用**：mp-frontend-obs — 前端 RUM（Real User Monitoring）
> **类别**：6. 可观测
> **对应 namespace**：mp-frontend
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-frontend-obs` 提供 v6.0 前端的**真实用户监控（RUM）**：Web Vitals / JS 错误 / 用户行为路径 / Session Replay。

## 2. 核心功能

- Web Vitals（LCP / FID / CLS / INP）
- JS 错误捕获（含 source map 反混淆）
- 用户行为路径（点击 / 路由 / 表单）
- Session Replay（可选）
- 性能分析（按页面 / 按设备）

## 3. 关键接口

```typescript
// 前端 SDK 上报
window.observability.track('web-vital', {
  metric: 'LCP',
  value: 2.3,
  page: '/orders/list',
  userId: '...',
  tenantId: '...'
});

// 后端查询
GET /v1/frontend-obs/metrics/web-vitals?from=...&to=...&tenant_id=...
// → { avg_lcp, 1, p95_cls, ... }

GET /v1/frontend-obs/errors?tenant_id=...&from=...&to=...
// → [{ message, stack, count, last_seen, ... }]
```

## 4. 数据模型

```sql
CREATE TABLE mp_frontend_obs.web_vitals (
    id           bigserial PRIMARY KEY,
    tenant_id    uuid,
    user_id      uuid,
    session_id   text NOT NULL,
    page         text NOT NULL,
    metric       text NOT NULL,                     -- LCP / FID / CLS / INP
    value        numeric(10,3) NOT NULL,
    device       text,                              -- mobile / desktop
    browser      text,
    occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_frontend_obs.js_errors (
    id           bigserial PRIMARY KEY,
    tenant_id    uuid,
    user_id      uuid,
    session_id   text NOT NULL,
    page         text NOT NULL,
    message      text NOT NULL,
    stack        text,
    source_map_resolved_stack text,
    count        int NOT NULL DEFAULT 1,
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX js_errors_hash_idx ON mp_frontend_obs.js_errors (tenant_id, md5(message), page);

ALTER TABLE mp_frontend_obs.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 前端 SDK：`@mp/frontend-obs`（npm 包）
- 后端 API：`harbor.mp-platform.local/mp/frontend-obs:v6.0.0-<sha>`
- 副本：HPA 2-10
- 资源：CPU 500m / Memory 512Mi
- 入口：`api.mp-platform.local/frontend-obs/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | Web Vitals 自动采集（LCP / FID / CLS / INP）|
| AC2 | JS 错误捕获 + source map 反混淆 |
| AC3 | 错误聚合（按 message + page 哈希）|
| AC4 | Session Replay（可选）|
| AC5 | 性能仪表盘（p75 / p95 / p99）|

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MetaPlatform-FOUNDATION-01 |
| Source map 上传（CI）| 自家 |

## 8. 不做

- ❌ 服务端 APM（由 OTel 负责）
- ❌ 移动端 RUM（v6.1 引入）
- ❌ A/B 测试（v6.1）
- ❌ 用户画像（v6.1）

---

*PRD v1.0 — 配套 [otel-collector-config](otel-collector-config.md) / [mp-monitoring](mp-monitoring.md)*