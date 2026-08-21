# PRD：mp-runtime（业务运行时）

> **应用**：mp-runtime — TypeScript 业务运行时（Edge Functions + Workers）
> **类别**：1. 平台核心
> **对应 namespace**：mp-runtime
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-runtime` 是 v6.0 的**业务逻辑运行时**，承载所有非 AI 类业务逻辑（17 域 Edge Functions + 通用业务 SDK）。基于 **Deno + Supabase Edge Functions**（TypeScript），业务团队通过写 Edge Function 部署到 `mp-business` namespace 即可发布 API。

## 2. 核心功能

- Edge Function 部署 / 版本管理
- 多租户上下文注入（`tenant_id` 自动注入 JWT claim）
- 业务 SDK（统一调用 Supabase PG / Auth / Storage / Realtime）
- OTel 自动接入
- 错误处理 + 重试 + 限流
- 函数冷启动优化（V8 snapshot）

## 3. 关键接口

```typescript
// Edge Function 标准签名
import { MPContext } from '@mp/runtime';

interface Request {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

Deno.serve(async (req: Request) => {
  const ctx = await MPContext.fromRequest(req);  // 注入 tenant_id / actor_id
  // 业务逻辑
  return ctx.json({ ok: true });
});
```

## 4. 数据模型

```sql
-- 运行时注册的 Edge Function 元数据
CREATE TABLE mp_runtime.functions (
    id           uuid PRIMARY KEY,
    name         text NOT NULL UNIQUE,
    version      text NOT NULL,
    handler      text NOT NULL,         -- 'mp-orders/create-order'
    tenant_id    uuid REFERENCES public.tenants(id),  -- NULL = 全局
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mp_runtime.functions ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 基础镜像：`harbor.mp-platform.local/mp/edge-runtime:v6.0.0`（基于 Deno + 业务 SDK）
- 副本：HPA 根据 QPS（2-50 副本）
- 冷启动：< 200ms（V8 snapshot）
- 入口：`/functions/v1/<name>`（Supabase Kong 网关路由）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 部署一个 hello world Edge Function 全流程跑通 |
| AC2 | 多租户 ctx 自动注入（不传 `tenant_id` 也生效）|
| AC3 | 跨租户调用被 RLS 拒 |
| AC4 | OTel trace 含 `tenant.id` / `function.name` |
| AC5 | 冷启动延迟 < 200ms（p99） |
| AC6 | 函数级限流（默认 100 QPS / 函数）|

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase Edge Functions | MetaPlatform-FOUNDATION-01 |
| Deno runtime | v6.0 决策 |
| OTel SDK | MetaPlatform-OBSERVABILITY-01 |

## 8. 不做

- ❌ Python / Node.js（非 Deno）Edge Functions
- ❌ 长任务（用 Temporal Worker 而非 Edge Function）
- ❌ WebSocket 服务端（用 Supabase Realtime）
- ❌ 文件存储逻辑（用 Supabase Storage）

---

*PRD v1.0 — 配套 [foundation-supabase-schema](foundation-supabase-schema.md) / [temporal-worker-sdk](temporal-worker-sdk.md)*