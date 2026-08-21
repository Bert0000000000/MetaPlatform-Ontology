# PRD：temporal-cluster

> **模块**：业务 Workflow 编排 — Temporal Cluster + Supabase Postgres 持久化
> **对应 Batch**：[MetaPlatform-TEMPORAL-01](../batch/MetaPlatform-TEMPORAL-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

部署 Temporal Cluster，复用 Supabase Postgres 作为持久化存储，让业务 Workflow 编排（ActionType 触发、长任务、HITL 联动）就绪。Cluster 与 Worker 分两个 PRD：
- **本 PRD**：Cluster + Postgres schema + namespace 隔离
- **Worker SDK** 单独：[temporal-worker-sdk.md](./temporal-worker-sdk.md)

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 用 Flowable BPMN（Java），能力上限明显（不支持外部 API 长等待、状态机复杂）
- v6.0 切到 Temporal.io（决策 #4，见 [architecture spec §1](../specs/2026-08-19-mp-v6-architecture.md)）
- **复用 Supabase Postgres**：避免新增一套持久化（一致性、备份、监控统一）

### 2.2 目标

| # | 目标 | 度量 |
|---|---|---|
| G1 | Temporal Cluster 高可用（≥ 3 历史 shard、≥ 2 frontend）| helm values + 健康检查 |
| G2 | 持久化与业务库**隔离**（专用 schema + 专用 user）| `temporal` schema 独立 |
| G3 | 三套环境（dev / staging / prod）独立 Temporal namespace | `temporal operator namespace list` |
| G4 | RPO ≤ 5 分钟（继承 Supabase PITR）| 与 [foundation-dr-backup](foundation-dr-backup.md) 一致 |
| G5 | OTel metrics 上报到 OBSERVABILITY-01 | Prometheus scrape 成功 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **业务 Workflow Owner** | 注册 workflow 定义；查询 workflow 状态 |
| **SRE** | 监控 Temporal Server 健康；扩缩容；故障排查 |
| **HITL Hub Owner** | 通过 Temporal signal 触发 HITL 4 类 |
| **DBA** | 监控 `temporal` schema 容量；执行 PITR |

## 4. 功能需求（Functional Requirements）

### 4.1 Temporal Cluster 组件

| 组件 | 副本数（prod）| 用途 |
|---|---|---|
| Frontend | 2 | gRPC `:7233` 入口；路由请求 |
| History | 4 | workflow 状态机持久化 |
| Matching | 4 | task queue 调度 |
| Worker | 0（业务自有）| 跑 workflow 代码 |
| Web UI | 1 | `:8233` 调试界面（SRE / 开发用）|

### 4.2 Postgres 准备

#### 4.2.1 专用 schema

```sql
-- 在 Supabase PG 中创建（service_role 执行）
CREATE SCHEMA temporal;
COMMENT ON SCHEMA temporal IS 'Owned by Temporal Cluster. RLS-exempt (system account).';

-- 专用 user（最小权限）
CREATE USER temporal_user WITH PASSWORD '<from-vault>';
GRANT CONNECT ON DATABASE postgres TO temporal_user;
GRANT USAGE, CREATE ON SCHEMA temporal TO temporal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO temporal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT USAGE, SELECT ON SEQUENCES TO temporal_user;
```

#### 4.2.2 Schema migration

```bash
# 用 Temporal 官方 SQL tool
temporal sql --db-type postgres \
  --db-host <supabase-host> \
  --db-port 5432 \
  --db-name postgres \
  --db-user temporal_user \
  --db-pass <from-vault> \
  --schema temporal \
  --setup-schema
```

**CI gate**：schema migration 必须幂等（重复执行不报错）。

#### 4.2.3 RLS 豁免

`temporal` schema 下所有表必须 `DISABLE ROW LEVEL SECURITY`，并在 `evidence/MetaPlatform-FOUNDATION-01-RLS-EXEMPTIONS.md` 中登记豁免理由（理由：Temporal 系统账号必须全权访问）。

### 4.3 Temporal namespace 隔离

| Temporal namespace | 对应 K8s 环境 | 用途 |
|---|---|---|
| `mp-platform` | prod | 生产 workflow |
| `mp-platform-staging` | staging | 预发 workflow |
| `mp-platform-dev` | dev | 开发 workflow |

**Namespace 注册**：

```bash
temporal operator namespace create \
  --namespace mp-platform \
  --retention 7d \
  --description "Production workflows"

temporal operator namespace create \
  --namespace mp-platform-staging \
  --retention 3d

temporal operator namespace create \
  --namespace mp-platform-dev \
  --retention 1d \
  --history-archival-state disabled \
  --visibility-archival-state disabled
```

### 4.4 Helm values

```yaml
# helm/mp-umbrella/values-<env>.yaml
temporal:
  enabled: true
  server:
    replicas:
      frontend: 2
      history: 4
      matching: 4
    config:
      dynamicConfig:
        history.persistence.namespace.divisor: 4
        matching.persistence.namespace.divisor: 4
    persistence:
      defaultStore:
        sql:
          host: <supabase-host>
          port: 5432
          database: postgres
          user: temporal_user
          passwordSecret: temporal-db-password
          schema: temporal
    metrics:
      enabled: true
      prometheus:
        enabled: true
        port: 9090
    web:
      enabled: true
      service:
        port: 8233
  # Worker 由各业务 Batch 自管，不在 Cluster chart 中
```

### 4.5 资源配额

| 组件 | CPU request | Memory request | CPU limit | Memory limit |
|---|---|---|---|---|
| Frontend | 500m | 512Mi | 1 | 1Gi |
| History | 1 | 1Gi | 2 | 2Gi |
| Matching | 500m | 512Mi | 1 | 1Gi |
| Web UI | 100m | 128Mi | 200m | 256Mi |

### 4.6 网络与安全

- 部署 namespace：`mp-orchestration`
- gRPC `:7233` 入口：仅同集群（应用通过 Cluster IP 访问）
- Web UI `:8233`：通过 ingress-nginx 暴露到 `temporal.mp-platform.local`（**仅 VPN / 内网访问**）
- NetworkPolicy：见 [foundation-networkpolicy](foundation-networkpolicy.md) §4.2 跨 namespace 矩阵
- service_account：`temporal-server`（绑定 `system:temporal-cluster` ClusterRole）

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **可用性** | Frontend ≥ 2 副本 + 负载均衡；History/Matching shard 化 |
| **持久化** | PITR RPO ≤ 5 分钟（继承 Supabase）|
| **可观测** | Prometheus 指标 → Grafana（[OBSERVABILITY-01](./otel-collector-config.md) 第 1 周期部署）|
| **性能** | workflow 启动延迟 < 100ms（p99）；Activity 调度 < 50ms（p99）|
| **隔离** | Temporal `temporal` schema 与业务 schema 严格分离；专用 user |
| **回滚** | Helm upgrade 自动 rollback；Postgres schema migration 不可逆必须显式审计 |

## 6. 接口契约

### 6.1 gRPC 入口

```
<env>.temporal.mp-platform.local:7233
```

### 6.2 Web UI

```
<env>.temporal.mp-platform.local:8233
```

### 6.3 Prometheus metrics

```
mp-orchestration/temporal-frontend:9090/metrics
mp-orchestration/temporal-history:9090/metrics
mp-orchestration/temporal-matching:9090/metrics
```

关键指标（需在 OTel Collector 配置中包含）：
- `temporal_workflow_start_count`
- `temporal_workflow_end_count`
- `temporal_activity_start_count`
- `temporal_task_queue_latency`（p50/p99）
- `temporal_history_shard_lag`

### 6.4 Database 凭证

凭证走 Vault → ExternalSecret → K8s Secret。**永远不进 git**（CI gate `secret-scan` 校验）。

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: temporal-db-password
  namespace: mp-orchestration
spec:
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: temporal-db-password
  data:
  - secretKey: password
    remoteRef:
      key: secret/data/mp/temporal/db
      property: password
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | Temporal Server 部署成功（Frontend/History/Matching） | `kubectl get pods -n mp-orchestration` |
| AC2 | Temporal UI 可访问（VPN 内） | `curl https://temporal.staging.mp-platform.local:8233` |
| AC3 | `temporal` schema migration 完成 | `psql \dn temporal` + 检查表结构 |
| AC4 | 3 个 Temporal namespace 已注册（mp-platform / staging / dev） | `temporal operator namespace list` |
| AC5 | Prometheus metrics 上报成功 | Grafana dashboard 显示数据 |
| AC6 | 端到端测试：启动 hello world workflow → 完成 | tctl workflow start + result |
| AC7 | 24h 长任务测试通过（wait_condition） | 单独 workflow 测试 |
| AC8 | RLS 豁免清单已更新 | `evidence/MetaPlatform-FOUNDATION-01-RLS-EXEMPTIONS.md` |
| AC9 | evidence/MetaPlatform-TEMPORAL-01-ACCEPTANCE.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Supabase Postgres | MetaPlatform-FOUNDATION-01 | 必须先 |
| `mp-orchestration` namespace | MetaPlatform-FOUNDATION-01 | 必须先 |
| OTel Collector | MetaPlatform-OBSERVABILITY-01 | 弱依赖（metrics 可在 OBS 之前直接 scrape）|
| Vault | MetaPlatform-FOUNDATION-01 | 必须先 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Temporal 与 Supabase PG 共用，资源争抢 | Supabase 业务表变慢 | Temporal 用专用 schema + 专用 user + ResourceQuota |
| 长任务 history 膨胀 | PG 容量压力 | `continue-as-new` 策略 + namespace retention（7d / 3d / 1d）|
| Temporal 版本升级 breaking | workflow 中断 | pin 版本 + staging 验证 + ArgoCD 自动 sync |
| Worker 任务堆积 | 任务延迟 | K8s HPA + concurrency limit（Worker SDK PRD 详述）|
| Schema migration 失败 | Cluster 起不来 | idempotent migration + staging dry-run |

## 10. 不做（Out of Scope）

- ❌ **Temporal Cloud**：v6.0 自托管
- ❌ **多 region active-active**：单 region 写
- ❌ **ElasticSearch visibility**：用 PG visibility（v6.0）
- ❌ **Archival（历史归档到 S3）**：v6.0 不启用；v6.1 引入
- ❌ **业务 workflow 定义**：在 [temporal-worker-sdk](temporal-worker-sdk.md) 与各业务 Batch

---

*PRD v1.0 — 配套 [temporal-worker-sdk](temporal-worker-sdk.md) / [foundation-supabase-schema](foundation-supabase-schema.md) / [otel-collector-config](otel-collector-config.md)*