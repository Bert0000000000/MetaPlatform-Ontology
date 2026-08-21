# PRD：mp-ontology（本体引擎）

> **应用**：mp-ontology — 本体 / 对象模型引擎
> **类别**：2. AI 能力
> **对应 namespace**：mp-ai
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-ontology` 是 v6.0 的**12 个 Ontology Kernel**（来自 [architecture spec §2.4](../specs/2026-08-19-mp-v6-architecture.md)）：定义业务领域的对象类型（Customer / Order / Product / Contract …）、属性、关系、约束，让 17 域业务数据有统一的元模型。

## 2. 核心功能

- **12 Kernel 元模型**：Entity / Relation / Attribute / Event / State / Action / Role / Policy / Workflow / Document / Tag / Comment
- 业务 ObjectType 注册（Customer / Order 等）
- ObjectType 实例化（CRUD + RLS）
- 关系查询（图查询）
- 软删 + 版本审计
- 元数据驱动 UI（基于 ObjectType 自动生成表单）

## 3. 关键接口（GraphQL）

```graphql
type ObjectType {
  id: ID!
  name: String!                  # "Customer"
  kernelType: KernelType!        # ENTITY
  attributes: [Attribute!]!
  relations: [Relation!]!
}

type Entity {
  id: ID!
  tenantId: ID!
  typeName: String!
  attributes: JSON!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Query {
  objectTypes: [ObjectType!]!
  entities(typeName: String!, cursor: String, limit: Int = 50): EntityConnection!
  relatedEntities(entityId: ID!, relationType: String!): [Entity!]!
}

type Mutation {
  createEntity(typeName: String!, attributes: JSON!): Entity!
  updateEntity(id: ID!, attributes: JSON!): Entity!
  deleteEntity(id: ID!): Boolean!     # 软删
  createRelation(fromId: ID!, toId: ID!, relationType: String!): Relation!
}
```

## 4. 数据模型

```sql
-- 元模型定义
CREATE TABLE mp_ontology.object_types (
    id           uuid PRIMARY KEY,
    name         text NOT NULL,
    kernel_type  text NOT NULL,                    -- ENTITY / RELATION / ...
    tenant_id    uuid REFERENCES public.tenants(id), -- NULL = 全局
    schema       jsonb NOT NULL,                    -- 属性定义
    version      int NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, version)
);

-- 通用实体表（所有业务实体都在这里，attributes 用 JSONB）
CREATE TABLE mp_ontology.entities (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
    type_name    text NOT NULL,
    attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE INDEX entities_tenant_type_idx ON mp_ontology.entities (tenant_id, type_name) WHERE deleted_at IS NULL;

-- 关系表（图）
CREATE TABLE mp_ontology.relations (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
    from_id      uuid NOT NULL REFERENCES mp_ontology.entities(id),
    to_id        uuid NOT NULL REFERENCES mp_ontology.entities(id),
    relation_type text NOT NULL,
    attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relations_from_idx ON mp_ontology.relations (from_id);
CREATE INDEX relations_to_idx   ON mp_ontology.relations (to_id);

ALTER TABLE mp_ontology.entities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_ontology.relations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_ontology.object_types ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/ontology:v6.0.0-<sha>`
- 副本：HPA 2-8
- 资源：CPU 500m / Memory 1Gi
- 入口：`api.mp-platform.local/ontology/v1/graphql`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 注册 5 个示例 ObjectType（Customer / Order / Product / Contract / Supplier）|
| AC2 | 实体 CRUD 端到端测试 |
| AC3 | 关系查询（"查询某订单的所有商品"）|
| AC4 | JSONB 属性查询（"查所有 status=active 的订单"）|
| AC5 | 软删 + 审计日志 |
| AC6 | 多租户隔离 |
| AC7 | 元数据驱动 UI：根据 ObjectType schema 自动生成前端表单 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG + JSONB | MetaPlatform-FOUNDATION-01 |
| RLS policy 模板 | [foundation-rls-policy](foundation-rls-policy.md) |

## 8. 不做

- ❌ OWL / RDF / SKOS 语义网本体（v6.0 不做）
- ❌ 图数据库（Neo4j）：v6.0 用 PG JSONB
- ❌ 自动推理（reasoner）：v6.1 引入
- ❌ 跨 ObjectType JOIN 性能优化（v6.1）

---

*PRD v1.0 — 配套 [foundation-supabase-schema](foundation-supabase-schema.md) / [mp-knowledge](mp-knowledge.md) / [mp-data-platform](mp-data-platform.md)*