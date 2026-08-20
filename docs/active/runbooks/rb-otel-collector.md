# Runbook：OTel Collector 数据丢失 / 告警风暴

> **适用**：应用 trace / metric / log 收不到、告警风暴
> **严重度**：P0（数据丢失）/ P1（告警风暴）
> **负责人**：SRE
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **应用 trace 收不到** | Grafana Tempo 无数据 | §3.1 |
| **Metric 数据缺口** | Prometheus scrape 失败 | §3.2 |
| **日志没采集** | Grafana Loki 无数据 | §3.3 |
| **告警风暴** | 同一告警短时间内反复触发 | §3.4 |
| **Collector OOM** | OTel Collector 重启 | §3.5 |

---

## 2. 前置检查

```bash
# 1. OTel Collector 状态
kubectl get pods -n mp-monitoring -l app=opentelemetry-collector

# 2. Collector 健康检查
curl http://otel-collector.mp-monitoring:13133/health
curl http://otel-collector.mp-monitoring:8889/metrics | tail -10

# 3. 应用是否上报
kubectl logs -n <ns> <pod> | grep -i otel

# 4. NetworkPolicy 是否拦截
kubectl get networkpolicy -n mp-monitoring
kubectl get networkpolicy -n <ns>

# 5. 后端存储状态
kubectl get pods -n mp-monitoring -l app=tempo
kubectl get pods -n mp-monitoring -l app=prometheus
kubectl get pods -n mp-monitoring -l app=loki
```

---

## 3. 故障 SOP

### 3.1 应用 trace 收不到

```bash
# 1. 确认 Collector 接收端 OK
kubectl logs -n mp-monitoring -l app=opentelemetry-collector --tail=200 | grep -E 'receiver|otlp'

# 2. 测试 OTLP 推送
grpcurl -plaintext otel-collector.mp-monitoring:4317 \
  otlp.collector.metrics.v1.MetricsService/Export

# 3. 检查 Tail Sampling 策略（可能把 trace 全 drop 了）
kubectl get configmap -n mp-monitoring otel-collector -o yaml | grep -A 20 tail_sampling

# 4. 检查 Tempo exporter 是否报错
kubectl logs -n mp-monitoring -l app=opentelemetry-collector | grep -i 'tempo.*error'

# 5. 验证 Tempo 写入
curl -u admin:admin http://tempo.mp-monitoring:3100/api/echo

# 6. 常见原因：
# a) Collector 没起 receiver → 重启
kubectl rollout restart deployment/opentelemetry-collector -n mp-monitoring

# b) Tempo 磁盘满
kubectl exec -n mp-monitoring <tempo-pod> -- df -h /var/tempo
# 解决：扩容 PV / 调整 retention

# c) NetworkPolicy 拦截
# 详见 foundation-networkpolicy 白名单
```

### 3.2 Metric 数据缺口

```bash
# 1. Prometheus targets
kubectl port-forward -n mp-monitoring svc/prometheus 9090:9090 &
# UI: http://localhost:9090/targets

# 2. 看 scrape 错误
# UI: Status → Targets → 找 failing

# 3. 手动验证
curl http://prometheus.mp-monitoring:9090/api/v1/targets | jq '.data.activeTargets[] | select(.health!="up")'

# 4. 常见原因：
# a) Prometheus OOM
kubectl top pods -n mp-monitoring -l app=prometheus
# 解决：扩容

# b) 应用没暴露 metrics endpoint
# 检查应用是否启动 OTel SDK + metrics port

# c) ServiceMonitor 配置错误
kubectl get servicemonitor -n mp-monitoring

# 5. 重启 Prometheus（重置内存）
kubectl rollout restart statefulset/prometheus -n mp-monitoring
```

### 3.3 日志没采集

```bash
# 1. 应用 stdout 是否写
kubectl logs -n <ns> <pod> --tail=10

# 2. OTel Collector 是否接收 logs pipeline
kubectl get configmap -n mp-monitoring otel-collector -o yaml | grep -A 10 'logs:'

# 3. Loki 查询
curl http://loki.mp-monitoring:3100/loki/api/v1/labels

# 4. 常见原因：
# a) 应用日志走 stderr（Collector 默认只收 stdout）
# 解决：collector config 加 stderr receiver
# b) Loki 写入失败
kubectl logs -n mp-monitoring -l app=loki | grep -i error
```

### 3.4 告警风暴

```bash
# 1. 看告警频率
kubectl port-forward -n mp-monitoring svc/alertmanager 9093:9093 &
# UI: http://localhost:9093/#/alerts

# 2. 临时抑制（inhibit 规则）
# alertmanager.yaml 加 inhibit_rule

# 3. 紧急停告警
amtool silence add --alertmanager=alertmanager.mp-monitoring:9093 \
  --duration=1h --comment="风暴抑制" \
  --matchers='alertname=~".+"'

# 4. 永久修复：调整阈值 / 修复根因
```

### 3.5 Collector OOM

```bash
# 1. 看 memory 配置
kubectl get deployment -n mp-monitoring opentelemetry-collector -o yaml | grep -A 5 resources

# 2. 看实际内存使用
kubectl top pods -n mp-monitoring -l app=opentelemetry-collector

# 3. 临时：扩容
kubectl scale deployment/opentelemetry-collector -n mp-monitoring --replicas=5

# 4. 永久：调高 memory_limiter 上限 + batch 调小
# collector config：
# memory_limiter:
#   limit_percentage: 90
# batch:
#   send_batch_max_size: 5000

# 5. 看 backpressure
kubectl logs -n mp-monitoring -l app=opentelemetry-collector | grep -i 'backpressure\|throttle'
```

---

## 4. 回滚步骤

如果 OTel Collector 配置改坏了：

```bash
# 1. Helm rollback
helm history opentelemetry-collector -n mp-monitoring
helm rollback opentelemetry-collector <REVISION> -n mp-monitoring

# 2. 或者 git revert config + ArgoCD sync
```

---

## 5. 升级检查表

- [ ] OTel SDK 版本固定（应用侧）
- [ ] Collector 版本升级在 staging 验证 24h
- [ ] 后端存储容量监控（避免磁盘满）
- [ ] Alertmanager 抑制规则 review
- [ ] 仪表盘更新（应用新版本指标）

---

## 6. 联系人

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（数据完全丢失）| SRE Lead | Slack #incident-prod + PagerDuty |
| P1（告警风暴）| SRE | Slack #ops-prod |
| P2（数据缺口 < 1h）| SRE | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: otel-collector-config](../prd/otel-collector-config.md)*