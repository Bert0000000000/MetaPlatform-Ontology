# docs/active/api/

> 接口规范目录。**所有外部 API 必须有 OpenAPI / GraphQL SDL 定义**，作为前后端 / 跨应用契约的唯一真相源。

## 索引

### REST（OpenAPI 3.1）

| API | 文件 | 配套 PRD |
|---|---|---|
| mp-platform | [mp-platform.openapi.yaml](./mp-platform.openapi.yaml) | [mp-platform](../prd/mp-platform.md) |
| mp-runtime（Edge Functions）| [mp-runtime.openapi.yaml](./mp-runtime.openapi.yaml) | [mp-runtime](../prd/mp-runtime.md) |
| mp-ai（LLM Gateway）| [mp-ai.openapi.yaml](./mp-ai.openapi.yaml) | [mp-ai](../prd/mp-ai.md) |
| mp-workflow | [mp-workflow.openapi.yaml](./mp-workflow.openapi.yaml) | [mp-workflow](../prd/mp-workflow.md) |
| mp-agent-team（WebSocket）| [mp-agent-team.openapi.yaml](./mp-agent-team.openapi.yaml) | [mp-agent-team](../prd/mp-agent-team.md) |
| mp-hitl-hub | [mp-hitl-hub.openapi.yaml](./mp-hitl-hub.openapi.yaml) | [mp-hitl-hub](../prd/mp-hitl-hub.md) |
| mp-knowledge | [mp-knowledge.openapi.yaml](./mp-knowledge.openapi.yaml) | [mp-knowledge](../prd/mp-knowledge.md) |
| mp-audit | [mp-audit.openapi.yaml](./mp-audit.openapi.yaml) | [mp-audit](../prd/mp-audit.md) |

### GraphQL SDL

| API | 文件 | 配套 PRD |
|---|---|---|
| mp-platform | [mp-platform.graphql](./mp-platform.graphql) | [mp-platform](../prd/mp-platform.md) |
| mp-ontology | [mp-ontology.graphql](./mp-ontology.graphql) | [mp-ontology](../prd/mp-ontology.md) |

### 测试套件（`tests/`）

| 类型 | 路径 |
|---|---|
| pgTAP（DB schema / RLS）| [tests/db/](../../tests/db/) |
| Playwright（E2E）| [tests/e2e/](../../tests/e2e/) |
| Vitest（单元）| [tests/unit/](../../tests/unit/) |

## 规范

### API 设计原则

- 所有 REST API 用 OpenAPI 3.1
- 所有 GraphQL API 用 SDL（Apollo Federation v2）
- 命名规范：`<app>/v1/<resource>/<action>`
- 错误响应：统一格式（见 [errors.md](./errors.md)）
- 认证：JWT Bearer + tenant_id 强制 claim
- 限流：默认 100 QPS / tenant / endpoint

### 版本管理

- URL 路径版本（v1 / v2）
- 旧版本保留 6 个月 deprecation period
- Breaking change 必须先 ADR

## 工具链

- **OpenAPI**：Swagger Editor / Redoc / Stoplight
- **GraphQL**：Apollo Studio / GraphQL Playground
- **客户端生成**：`openapi-typescript` / `@graphql-codegen/cli`
- **服务端验证**：`express-openapi-validator` / `graphql-shield`

## CI 校验

- OpenAPI linter：`redocly lint`
- GraphQL linter：`graphql-schema-linter`
- Breaking change 检测：`oasdiff`（PR 阶段）