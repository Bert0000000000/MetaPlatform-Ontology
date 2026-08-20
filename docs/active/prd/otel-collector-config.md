# PRD：otel-collector-config

> **模块**：可观测层 — OTel Collector + 4 个基础 Dashboard + 告警规则
> **对应 Batch**：[MP-V6-OBSERVABILITY-01](../batch/MP-V6-OBSERVABILITY-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

为 v6.0 部署统一可观测栈：**OTel Collector + Tempo + Prometheus + Loki + Grafana**，所有 19 个应用、9 个 namespace 自动接入，输出 trace / metric / log 三类数据。

**本 PRD 不包含**：
- 业务自定义 Dashboard（业务 Owner 按需加）
- 业务告警规则（业务 Owner 按需加）
- 第三方 APM 接入（Datadog / New Relic）：v6.0 不引入

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期"自研监控"：每应用各自实现 metric 上报，tracing 缺失
- v6.0 切到 OTel 栈（决策 §1 表第 4 行，见 [architecture spec §1](../specs/2026-08-19-mp-v6-architecture.md)）
- **语言无关 SDK**：OTel SDK 支持 Node / Python / Go / Java，应用侧零切换成本

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 部署 OTel Collector + 4 个存储后端 + Grafana，**2 周内完成** |
| G2 | 应用**零代码改动**接入（通过 OTLP endpoint + sidecar 自动注入）|
| G3 | 4 个基础 Dashboard 上线：应用健康 / K8s / Supabase PG / Temporal |
| G4 | 3 级告警（Critical / Warning / Info）+ 多通道通知（邮件 / 钉钉 / Slack）|
| G5 | 所有数据自动打 `tenant.id` / `service.name` / `k8s.namespace` |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **应用 Owner** | 在 Grafana 查自己的应用 QPS / 错误率 / trace |
| **SRE** | 跨服务 trace 排查；配置告警规则；故障响应 |
| **DBA** | 查 Supabase PG QPS / 慢查询 / 连接数 |
| **架构组** | 评审 OTel Collector pipeline / 采样策略 |

## 4. 功能需求（Functional Requirements）

### 4.1 部署架构

```
应用 Pod (OTel SDK)
  └─→ OTLP (gRPC :4317 / HTTP :4318)
       └─→ OTel Collector (mp-monitoring namespace)
            ├─→ traces → Tempo
            ├─→ metrics → Prometheus
            ├─→ logs → Loki
            └─→ health → K8s liveness probe
                  ↓
              Grafana (查询面板 + 告警)
```

### 4.2 OTel Collector 配置

```yaml
# helm/mp-umbrella/charts/otel-collector/values.yaml
mode: deployment
image:
  repository: otel/opentelemetry-collector-contrib
  tag: 0.103.0
resources:
  requests: { cpu: 500m, memory: 1Gi }
  limits: { cpu: 2, memory: 4Gi }

config:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318

  processors:
    # 自动注入 k8s attributes
    k8sattributes:
      extract:
        metadata:
          - k8s.pod.name
          - k8s.namespace.name
          - k8s.deployment.name
          - k8s.container.name
        annotations:
          - container.googleapis.com/container_name  # 兼容 GKE
      pod_association:
        - sources:
          - from: resource_attribute
            name: k8s.pod.ip

    # 批量发送
    batch:
      send_batch_size: 8192
      send_batch_max_size: 10000
      timeout: 5s

    # 内存限制
    memory_limiter:
      check_interval: 1s
      limit_percentage: 80
      spike_limit_percentage: 25

    # 采样（生产）
    tail_sampling:
      decision_wait: 10s
      num_traces: 50000
      expected_new_traces_per_sec: 100
      policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow-traces
        type: latency
        latency: { threshold_ms: 3000 }
      - name: default
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

    # tenant.id / service.name 注入（业务自定义属性）
    transform:
      trace_statements:
      - context: resource
        statements:
        - set(attributes["platform.mp"], "v6.0")
        - set(attributes["deployment.environment"], env("ENVIRONMENT"))

  exporters:
    otlp/tempo:
      endpoint: tempo.mp-monitoring:4317
      tls: { insecure: true }
      sending_queue: { enabled: true, num_consumers: 10 }

    prometheus:
      endpoint: 0.0.0.0:8889
      resource_to_telemetry_conversion: { enabled: true }

    loki:
      endpoint: http://loki.mp-monitoring:3100/loki/api/v1/push

    debug:
      verbosity: basic

  service:
    pipelines:
      traces:
        receivers: [otlp]
        processors: [memory_limiter, k8sattributes, transform, tail_sampling, batch]
        exporters: [otlp/tempo]
      metrics:
        receivers: [otlp]
        processors: [memory_limiter, k8sattributes, transform, batch]
        exporters: [prometheus]
      logs:
        receivers: [otlp]
        processors: [memory_limiter, k8sattributes, transform, batch]
        exporters: [loki]
```

### 4.3 存储后端部署

| 组件 | 副本数 | 存储 | 保留期 |
|---|---|---|---|
| **Tempo** | 2 | 50Gi PV（trace 索引 + block）| 30 天 |
| **Prometheus** | 2 (shard) | 100Gi PV | 30 天（远程写可选 Thanos）|
| **Loki** | 2 (ingester) + 1 (querier) | 100Gi PV | 30 天 |
| **Grafana** | 1 (有状态) | 10Gi PV | 配置持久化 |

### 4.4 自动接入（Sidecar 注入）

每个业务 namespace 部署 **OTel SDK sidecar**（可选）；或者用 **K8s admission webhook** 自动注入 OTEL_EXPORTER_OTLP_ENDPOINT 环境变量。

**v6.0 简化**：手动注入 env 变量（业务 Owner 在 Helm values 里加）：

```yaml
env:
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: "http://otel-collector.mp-monitoring:4318"
- name: OTEL_SERVICE_NAME
  value: "{{ .Values.service.name }}"
- name: OTEL_RESOURCE_ATTRIBUTES
  value: "service.namespace={{ .Values.namespace }},deployment.environment={{ .Values.env }}"
- name: OTEL_EXPORTER_OTLP_PROTOCOL
  value: "http/protobuf"
```

**v6.1 升级**：用 OpenTelemetry Operator + Instrumentation CRD 自动注入。

### 4.5 4 个基础 Dashboard

#### 4.5.1 应用健康（App Health）

```
- QPS（每秒请求数，按 service.name 拆分）
- 错误率（5xx 比例）
- P50 / P95 / P99 延迟
- 上下游依赖 trace 概览
```

#### 4.5.2 K8s 基础设施

```
- 节点 CPU / 内存 / 网络使用率
- Pod 状态分布（Running / Pending / Failed）
- 各 namespace 资源使用
- HPA 当前副本数 vs 期望副本数
```

#### 4.5.3 Supabase PG

```
- 连接数（活跃 / 空闲 / 总数）
- QPS（按 schema 拆分）
- 慢查询 Top 10（pg_stat_statements）
- WAL 归档 lag
- 备份状态（最后一次成功时间）
```

#### 4.5.4 Temporal

```
- Workflow 启动 / 结束速率
- Activity 失败率
- Task Queue 深度（per queue）
- History Shard Lag
- Namespace 列表 + retention
```

Dashboard JSON 存放在 `helm/mp-umbrella/charts/grafana/dashboards/`，Grafana 通过 sidecar provider 自动加载。

### 4.6 告警规则

```yaml
# alerts/critical.yaml
groups:
- name: critical
  rules:
  - alert: HighErrorRate
    expr: |
      sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
        / sum(rate(http_requests_total[5m])) by (service) > 0.05
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "Error rate > 5% for {{ $labels.service }}"
      description: "Service {{ $labels.service }} has error rate {{ $value }}"

  - alert: P99LatencyHigh
    expr: |
      histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[10m])) by (le, service))
        > 3
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "P99 latency > 3s for {{ $labels.service }}"

  - alert: PGConnectionsHigh
    expr: pg_stat_activity_count > 80
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Postgres connections > 80%"

  - alert: BackupMissing
    expr: time() - velero_backup_last_successful_timestamp > 93600
    for: 1h
    labels:
      severity: critical
    annotations:
      summary: "Velero backup not successful in 26 hours"

  - alert: WALArchivalLag
    expr: pg_stat_archiver_last_archived_age_seconds > 300
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "WAL archival lag > 5 minutes"

  - alert: TemporalHistoryShardLag
    expr: temporal_history_shard_lag > 1000
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Temporal history shard lag > 1000"
```

### 4.7 通知渠道

| 级别 | 渠道 |
|---|---|
| **Critical** | 邮件 + 钉钉机器人 + Slack + PagerDuty |
| **Warning** | 邮件 + 钉钉机器人 + Slack |
| **Info** | Slack |

**v6.0 简化**：先打通 Slack + 邮件 + 钉钉，PagerDuty 留 v6.1。

```yaml
# Alertmanager config
route:
  receiver: 'default'
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
  - matchers: [severity=critical]
    receiver: 'pagerduty-critical'
    continue: false
  - matchers: [severity=warning]
    receiver: 'dingtalk-warning'
  - matchers: [severity=info]
    receiver: 'slack-info'

receivers:
- name: 'default'
  email_configs:
  - to: 'sre@mp-platform.local'
- name: 'pagerduty-critical'
  pagerduty_configs:
  - service_key: '<from-vault>'
- name: 'dingtalk-warning'
  webhook_configs:
  - url: '<dingtalk-webhook-from-vault>'
- name: 'slack-info'
  slack_configs:
  - api_url: '<slack-webhook-from-vault>'
    channel: '#mp-monitoring'
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **可靠性** | OTel Collector 至少 2 副本；存储多副本 |
| **采样策略** | 生产：10% 采样 + 100% 错误 + 100% 慢请求；dev：100% |
| **可扩展** | 通过增加 OTel Collector 副本水平扩展（无状态）|
| **多租户** | 所有数据自动打 `tenant.id`；Grafana 支持按 tenant 过滤 |
| **性能** | OTLP 接入 p99 < 10ms（Collector 内部）|
| **成本** | 30 天保留；超过 30 天数据自动清理 |

## 6. 接口契约

### 6.1 应用接入协议

```bash
# 标准环境变量
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.mp-monitoring:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=<service-name>
OTEL_RESOURCE_ATTRIBUTES=service.namespace=<ns>,deployment.environment=<env>
```

### 6.2 Grafana 数据源

```yaml
datasources:
- name: Tempo
  type: tempo
  url: http://tempo.mp-monitoring:3100
- name: Prometheus
  type: prometheus
  url: http://prometheus.mp-monitoring:9090
- name: Loki
  type: loki
  url: http://loki.mp-monitoring:3100
```

### 6.3 跨 namespace NetworkPolicy

- `*` → `mp-monitoring:4317/4318/8889/3100/9090`：允许
- `mp-monitoring` → `*` ingress：**默认拒绝**（避免被反向探测）

详见 [foundation-networkpolicy](foundation-networkpolicy.md) §4.2。

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | OTel Collector 运行且接收 OTLP | `kubectl logs` + 测试 push |
| AC2 | Tempo / Prometheus / Loki / Grafana 全部 Running | `kubectl get pods -n mp-monitoring` |
| AC3 | 4 个基础 Dashboard 配置完成 | Grafana UI |
| AC4 | 告警规则（Critical / Warning / Info）配置 | Prometheus rules |
| AC5 | 通知渠道验证（邮件 / 钉钉 / Slack） | 触发测试告警 |
| AC6 | 端到端测试：测试应用上报 trace → Grafana 显示 | e2e test |
| AC7 | 租户隔离：Grafana 按 tenant.id 过滤数据 | 测试 |
| AC8 | evidence/MP-V6-OBSERVABILITY-01-ACCEPTANCE.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| `mp-monitoring` namespace | MP-V6-FOUNDATION-01 | 必须先 |
| StorageClass（PV 供给）| MP-V6-FOUNDATION-01 | 必须先 |
| Slack / 钉钉 / 邮件 webhook | SRE 申请 | 启动前 |
| 第一个测试应用 | MP-V6-FOUNDATION-01 期间的任意服务 | 验证用 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|
| OTel Collector 单点 | 数据丢失 | 至少 2 副本 + 客户端重试 |
| Prometheus 存储膨胀 | 性能下降 | 30 天保留 + 远程写 Thanos（v6.1）|
| Grafana 配置丢失 | dashboard 重做 | PV 持久化 + 定期导出到 git |
| 告警风暴 | SRE 疲劳 | 告警聚合 + 重复抑制 + 抑制规则 |
| 采样策略过激 | 数据不全 | 默认 10% + 错误全采样；调试时可调 |

## 10. 不做（Out of Scope）

- ❌ **Datadog / New Relic**：v6.0 不引入第三方 APM
- ❌ **业务 Dashboard / 业务告警**：业务 Owner 按需加
- ❌ **跨 region 聚合**：v6.0 单 region
- ❌ **Trace 实时分析（Trace Analytics）**：v6.0 只存不分析，v6.1 引入
- ❌ **Synthetic Monitoring**：v6.0 不做主动探测
- ❌ **RUM（Real User Monitoring）**：v6.0 不引入前端 RUM

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [foundation-networkpolicy](foundation-networkpolicy.md) / [temporal-cluster](temporal-cluster.md) / [temporal-worker-sdk](temporal-worker-sdk.md)*