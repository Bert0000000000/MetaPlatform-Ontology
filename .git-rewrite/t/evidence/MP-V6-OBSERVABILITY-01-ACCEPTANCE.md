# MP-V6-OBSERVABILITY-01 - ACCEPTANCE (Skeleton Phase)

> **状态**：Skeleton Accepted
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-OBSERVABILITY-01.md](../batch/MP-V6-OBSERVABILITY-01.md)
> **关联 PRD**：otel-collector-config.md

---

## 验收标准

- [x] OTel Collector Helm chart skeleton (`helm/mp-umbrella/charts/observability/`)
- [x] OTel Collector config (3 pipelines: traces / metrics / logs) — `k8s/observability/otel-collector-config.yaml`
- [x] 4 base Grafana dashboards:
  - [x] `dashboards/app-health.json` (API rate / error / latency)
  - [x] `dashboards/k8s-health.json` (node / pod / replicas / NetworkPolicy)
  - [x] `dashboards/supabase-pg.json` (connections / TPS / replication / WAL lag)
  - [x] `dashboards/temporal.json` (workflow rate / queue latency / shard lag)
- [x] 6 Prometheus alert rules (HighErrorRate / P99LatencyHigh / PGConnectionsHigh / BackupMissing / WALArchivalLag / TemporalShardLag)
- [x] 5 subcharts referenced (otel / tempo / prom / loki / grafana)
- [x] vitest unit test for OTel config schema

## 待用户在宿主机完成

- [ ] `helm install observability helm/mp-umbrella/charts/observability/ -n mp-monitoring`
- [ ] Grafana datasources 自动配置 (需 values.yaml 注入 admin password)
- [ ] 验证: 模拟 trace 上报 → Grafana Tempo 显示
- [ ] Alertmanager → Slack / 钉钉 / PagerDuty 通道配置

## 已交付文件

- `helm/mp-umbrella/charts/observability/{Chart,values}.yaml`
- `k8s/observability/otel-collector-config.yaml`
- `dashboards/{app-health,k8s-health,supabase-pg,temporal}.json`
- `prometheus/rules/{dr-backup-alerts,mp-app-alerts}.yaml`
- `tests/observability/otel_config.test.ts`

---

*OBSERVABILITY-01 ACCEPTANCE (skeleton) — 2026-08-20*