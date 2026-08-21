# Schedules — 定时任务总览

> v6.0 全部定时 / 周期 / 触发式任务的**唯一索引**。每个任务都说明：触发方式、频率、跑的什么、在哪定义。

## 1. GitHub Actions cron（CI 触发）

| Workflow | 触发 | 跑什么 | 频率 / 模板 | 文件 |
|---|---|---|---|---|
| **CI** | `push` / `pull_request` 到 `main` | 8 项 CI gate（lint / typecheck / test / build / evidence-check / secret-scan / helm-validate / rls-check） | 每次 PR + push | [docs/active/workflows/ci.yml](../workflows/ci.yml) |
| **Release** | `tag v*` | dsh 镜像 build + push 到 Harbor + trivy + cosign | 每次发版 | [docs/active/workflows/release.yml](../workflows/release.yml) |
| **Deploy Prod** | `workflow_dispatch` | ArgoCD 同步生产 | 手动触发 | [docs/active/workflows/deploy-prod.yml](../workflows/deploy-prod.yml) |
| **Claude Loop** | `workflow_dispatch` + `issues` | Claude Code 自动接力 Batch | 手动 / 事件触发 | [docs/active/workflows/claude-loop.yml](../workflows/claude-loop.yml) |

> ⚠️ 这 4 个 workflow 模板在 `docs/active/workflows/`，**还没拷贝到 `.github/workflows/`**。见 START.md Step 4。

---

## 2. K8s / CronJob / 计划任务（部署后才有）

| 任务 | 频率 | 内容 | 文档 |
|---|---|---|---|
| **PG WAL 归档** | 实时（每 16MB 或 60s）| `archive_command = 'wal-g wal-push %f'` → 异地对象存储 | [foundation-dr-backup §4.1.2](../prd/foundation-dr-backup.md) |
| **PG 基础备份** | 每日 02:00 UTC | `wal-g backup-push --full` → 异地对象存储（保留 30 天）| [foundation-dr-backup §4.1.1](../prd/foundation-dr-backup.md) |
| **PG 月度归档** | 每月 1 日 02:00 UTC | 同期数据 → S3 Glacier（保留 7 年）| [foundation-dr-backup §4.1.1](../prd/foundation-dr-backup.md) |
| **Velero K8s 备份** | 每日 03:00 UTC | 备份所有 8 个业务 namespace（保留 30 天）| [foundation-dr-backup §4.2.3](../prd/foundation-dr-backup.md) |
| **灾备演练** | 每月 1 日 10:00 CST | 在 staging 集群从零恢复 PG，RPO/RTO 实测 | [foundation-dr-backup §4.6](../prd/foundation-dr-backup.md) |
| **dev 集群自动缩容** | 夜间 + 周末 | dev 集群 worker 缩到 1 节点（成本优化）| [foundation-k8s-clusters §5](../prd/foundation-k8s-clusters.md) |
| **数据 ETL 切流量** | 跨 4 周 | dev → staging → 1% canary → 50% → 100% | [etl-import-v6 §4.6](../prd/etl-import-v6.md) |
| **数据质量校验** | 业务定义（默认 `0 * * * *`）| 6 类规则 + 告警 | [mp-data-quality §4.3](../prd/mp-data-quality.md) |
| **指标定时刷新** | 业务定义（默认 daily）| 指标计算 + 缓存 | [mp-data-product §4.3](../prd/mp-data-product.md) |
| **dsh Postgres backend 清理** | 每日 | 过期 session 归档 | [mp-agent-team §4.5.3（规划中）](../prd/mp-agent-team.md) |

---

## 3. 监控 / 告警 cron（OTel + Prometheus）

| 任务 | 频率 | 检查什么 | 文档 |
|---|---|---|---|
| **OTel Tail Sampling** | 实时 | 100% 错误 / 慢请求 + 10% 正常请求 | [otel-collector-config §4.2](../prd/otel-collector-config.md) |
| **Prometheus 指标 scrape** | 每 15s | 全平台 metric | [otel-collector-config §4.3](../prd/otel-collector-config.md) |
| **告警评估** | 每 30s | Alertmanager 评估规则 | [otel-collector-config §4.6](../prd/otel-collector-config.md) |
| **WAL 归档 lag 检测** | 实时 | `pg_stat_archiver_last_archived_age_seconds > 300` | [otel-collector-config §4.7](../prd/otel-collector-config.md) |
| **备份缺失告警** | 实时 | `velero_backup_last_successful_timestamp > 93600` | [otel-collector-config §4.7](../prd/otel-collector-config.md) |
| **备份监控每日汇总** | 每日 09:00 | Slack 推送备份状态报告 | [otel-collector-config §4.7](../prd/otel-collector-config.md) |

---

## 4. 在哪里看实际跑起来的状态

| 阶段 | 怎么看 |
|---|---|
| **未部署** | 这份 PDF 还在 project 各处散落，**看本文件** |
| **CI workflow 部署后** | https://github.com/Bert0000000000/MetaPlatform-Ontology/actions |
| **K8s 部署后** | Grafana 面板 + Prometheus `velero_backup_*` / `pg_stat_archiver_*` 指标 |
| **月演练** | `evidence/dr-drills/<YYYY-MM>.md` |
| **Claude Code loop** | `.claude/current-batch.md` |

---

## 5. 触发式（非 cron，但有规律）

| 事件 | 触发 | 跑什么 |
|---|---|---|
| **PR 合并到 main** | GitHub Actions | CI 全套 + （规划中）Batch 自动接力 |
| **ETL 切流量关闭** | `setFeatureFlag(tenant, migration.v6.completed, false)` | 业务流量回滚到 v3.0 |
| **DSH 镜像新 tag** | `git tag v*` | release.yml 跑 build + push + sign |
| **Sev1 告警触发** | Alertmanager | Slack + PagerDuty + CEO 邮件 |

---

## 6. 还没编入 cron 的手动任务

| 任务 | 频率 | 文档 |
|---|---|---|
| 季度架构 review | 每 3 个月 | 架构组 |
| 半年度 RBAC 权限审计 | 每 6 个月 | 安全 + 架构 |
| 年度 KMS 密钥轮换 | 每年 | SRE |
| 年度 RLS exemption 复审 | 每年 | 架构组 + DBA |

---

## 7. 维护

- 新增定时任务 → 在此处加一行 + 在对应 PRD 加细节
- 删除 cron → 同时更新此处 + 删除 K8s CronJob
- 改频率 → 同步更新 这里 + 文档 + Slack 通知

---

*Schedules v1.0 — 配套所有 PRD / Runbook / Workflow*