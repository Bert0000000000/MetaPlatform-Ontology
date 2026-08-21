# MetaPlatform-TEMPORAL-01 - ACCEPTANCE (Skeleton Phase)

> **状态**：Skeleton Accepted (待用户在宿主机完成 live-deploy)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-TEMPORAL-01.md](../batch/MetaPlatform-TEMPORAL-01.md)
> **关联 PRDs**：temporal-cluster.md + temporal-worker-sdk.md

---

## 验收标准

复制自 Batch 文档 AC:

- [x] Temporal Server Helm chart skeleton (`helm/mp-umbrella/charts/temporal/`)
- [x] Temporal Worker TS SDK (`packages/mp-temporal-worker-template/`)
- [x] `temporal` schema + dedicated user (RLS-exempt) — `supabase/migrations/20260820120700_create_temporal_schema.sql`
- [x] 3 个 Temporal namespace 计划已写入 (`mp-platform` / `-staging` / `-dev`)
- [x] NativeConnection + AsyncLocalStorage TenantContext 模板
- [x] Hello world workflow + 24h wait_condition + signal 模板
- [x] 5 个 activity 模板 (sayHello / heartbeatStep / dbRead / dbWrite / approvalRequest)
- [x] vitest unit tests for context propagation (5 cases)

## 待用户在宿主机完成

- [ ] `helm install mp-temporal helm/mp-umbrella/charts/temporal/ -n mp-orchestration`
- [ ] `temporal sql --setup-schema` 应用 schema 到 Supabase PG
- [ ] `temporal operator namespace create` 创建 3 个 namespace
- [ ] 端到端: 启动 hello world workflow → 完成
- [ ] 24h 长任务测试 (wait_condition)
- [ ] Prometheus metrics 上报到 mp-monitoring

## 已交付文件

- `helm/mp-umbrella/charts/temporal/Chart.yaml`
- `helm/mp-umbrella/charts/temporal/values.yaml`
- `helm/mp-umbrella/charts/temporal/templates/server-deployment.yaml`
- `packages/mp-temporal-worker-template/src/{context,worker,workflows,activities,index}.ts`
- `packages/mp-temporal-worker-template/tests/{context,workflow_contract}.test.ts`
- `supabase/migrations/20260820120700_create_temporal_schema.sql`

---

*TEMPORAL-01 ACCEPTANCE (skeleton) — 2026-08-20*