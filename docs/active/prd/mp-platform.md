# PRD：mp-platform（业务平台）

> **应用**：mp-platform — 业务平台（租户 / 用户 / 菜单 / feature flag）
> **类别**：1. 平台核心
> **对应 namespace**：mp-platform
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-platform` 是 v6.0 业务侧的**总入口服务**，提供租户管理、用户管理、菜单、feature flag、etl 切流量等平台级 API。所有业务应用（mp-agent-team / mp-data-platform 等）都通过 `mp-platform` 间接访问基础数据。

## 2. 核心功能

- 租户 CRUD + 状态管理（active / suspended / archived）
- 用户 CRUD + 角色管理（owner / admin / member / guest）
- 动态菜单配置（按角色返回可见菜单）
- Feature Flag 管理（`migration.v6.completed` 等）
- 切流量接口（`/tenants/:id/migrate`）
- 审计日志查询（受 RLS 限制）
- 多租户隔离 RLS（继承自 [foundation-rls-policy](foundation-rls-policy.md)）

## 3. 关键接口（GraphQL）

```graphql
type Tenant {
  id: ID!
  slug: String!
  name: String!
  status: TenantStatus!
  metadata: JSON
  createdAt: DateTime!
}

type User {
  id: ID!
  tenantId: ID!
  email: String!
  displayName: String
  role: Role!
}

type Query {
  myTenants: [Tenant!]!
  tenant(id: ID!): Tenant
  users(tenantId: ID!, cursor: String, limit: Int = 50): UserConnection!
  menu(role: Role!): [MenuItem!]!
  featureFlags(tenantId: ID!): JSON!
}

type Mutation {
  createTenant(input: CreateTenantInput!): Tenant!
  updateTenant(id: ID!, input: UpdateTenantInput!): Tenant!
  migrateTenant(id: ID!, completed: Boolean!): Boolean!
  setFeatureFlag(tenantId: ID!, key: String!, value: JSON!): Boolean!
}
```

## 4. 数据模型

继承自 [foundation-supabase-schema](foundation-supabase-schema.md)：
- `public.tenants`、`public.profiles`、`public.audit_log`
- `mp_platform.feature_flags(tenant_id, key, value, updated_at)`（RLS）
- `mp_platform.migration_log(tenant_id, step, completed_at)`（切流量日志）

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/platform:v6.0.0-<sha>`
- 副本：HPA 2-10（QPS / CPU）
- 入口：`https://api.mp-platform.local/platform/v1/graphql`
- 资源：CPU 500m / Memory 512Mi（默认）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | GraphQL endpoint 跑通 + introspection 可用 |
| AC2 | 租户 CRUD 端到端测试（创建 → 查询 → 修改 → 删除）|
| AC3 | 切流量接口幂等（同 tenant 调用 2 次 idempotent）|
| AC4 | feature flag 实时生效（修改后 < 5s 全局可见）|
| AC5 | 跨租户访问被 RLS 拒 |
| AC6 | 所有写操作进 audit_log |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG + Auth | MP-V6-FOUNDATION-01 |
| [foundation-rls-policy](foundation-rls-policy.md) | MP-V6-FOUNDATION-01 |

## 8. 不做

- ❌ 业务领域逻辑（订单 / 客户）→ 由各业务应用自管
- ❌ 计费 / 订阅（v6.1 引入）
- ❌ 单点登录（SSO）v6.0 不做（v6.1）
- ❌ 工作流编排 → [mp-workflow](mp-workflow.md)

---

*PRD v1.0 — 配套 [foundation-supabase-schema](foundation-supabase-schema.md) / [etl-import-v6](etl-import-v6.md)*