# PRD：foundation-dr-backup

> **模块**：MetaPlatform v6.0 基础设施层 — 灾备与备份
> **对应 Batch**：[MP-V6-FOUNDATION-01](../batch/MP-V6-FOUNDATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + DBA
> **日期**：2026-08-20

---

## 1. 概述（What）

定义 v6.0 的 **灾备（DR）与备份（Backup）策略**，覆盖 Supabase Postgres、K8s 集群资源、关键配置，确保：

- **RPO ≤ 5 分钟**（数据丢失容忍窗口）
- **RTO ≤ 30 分钟**（恢复时间）
- 每月一次灾备演练
- 备份数据**异地存放**

**本 PRD 不实现**：具体业务数据的备份（那是各应用 Batch 的事）。**本 PRD 落地**：基础平台层的备份 / 恢复标准。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期"备份 = 每日 pg_dump"：RPO 24 小时，曾经因为故障丢失 8 小时订单数据
- 2024 年一次勒索软件攻击因缺少异地备份，恢复耗时 2 周
- v6.0 必须从一开始就建立 PITR + 异地 + 演练 三大支柱

### 2.2 目标

| # | 目标 | 度量 |
|---|---|---|
| G1 | RPO ≤ 5 分钟 | WAL 归档到异地对象存储 |
| G2 | RTO ≤ 30 分钟（生产集群全损场景）| IaC + 自动恢复脚本 |
| G3 | 每月 1 次灾备演练 | 演练日志 + 计时 |
| G4 | 备份数据异地存放 | 跨 region / 跨云厂商 |
| G5 | 备份**加密** + **不可篡改** | 对象存储服务端加密 + 对象锁 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **DBA** | 监控备份状态；做 PITR 恢复；季度演练 |
| **SRE** | K8s 资源恢复（Velero）；节点故障切换 |
| **应用 Owner** | 业务数据备份需求评审；接入备份 API |
| **合规** | 出具备份报告（数据保留 / 加密 / 异地）|

## 4. 功能需求（Functional Requirements）

### 4.1 Supabase Postgres 备份策略

#### 4.1.1 三层备份

| 层 | 频率 | 保留期 | 存储位置 | 恢复点 |
|---|---|---|---|---|
| **L1 WAL 归档** | 实时（每 16MB 或 60s） | 14 天 | 异地对象存储 | PITR 到秒级 |
| **L2 基础备份（pg_basebackup）** | 每日 02:00 UTC | 30 天 | 异地对象存储 | PITR 到天级 |
| **L3 月度归档** | 每月 1 日 | 7 年（合规） | 异地冷存储 | PITR 到月级 |

#### 4.1.2 WAL 归档配置

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %f'
archive_timeout = 60
max_wal_size = 1GB
min_wal_size = 512MB
```

**wal-g 推送目的地**：

```ini
# wal-g.env
WALG_S3_PREFIX=s3://mp-pg-backup-prod/<region>/wal/
AWS_ACCESS_KEY_ID=<via-vault>
AWS_SECRET_ACCESS_KEY=<via-vault>
WALG_COMPRESSION_METHOD=lz4
WALG_DELTA_MAX_STEPS=5
```

#### 4.1.3 基础备份脚本

```bash
#!/bin/bash
# /opt/supabase/backup/nightly-basebackup.sh
# 每日 02:00 UTC cron 执行
set -euo pipefail
export $(cat /opt/supabase/backup/wal-g.env | xargs)

wal-g backup-push \
  --full \
  --retention-days 30 \
  /var/lib/postgresql/data
```

### 4.2 K8s 资源备份（Velero）

#### 4.2.1 备份范围

| 范围 | 频率 | 保留 | 用途 |
|---|---|---|---|
| 所有 namespace 的 Deployment / Service / ConfigMap / Secret（不含 Secret 明文）| 每日 | 30 天 | 灾难恢复 |
| Helm release 记录 | 每日 | 30 天 | 灾难恢复 |
| CRD（cert-manager / ArgoCD）| 每日 | 30 天 | 灾难恢复 |

**不备份**：
- Pod（ephemeral）
- PV 数据（用专门的 PV 备份方案，见 §4.3）
- `kube-system` 内 ephemeral 资源

#### 4.2.2 Velero 安装

```bash
velero install \
  --provider aws \
  --bucket mp-velero-prod \
  --prefix mp-prod \
  --secret-file ./credentials-velero \
  --backup-location-config region=ap-shanghai,s3ForcePathStyle=true \
  --use-restic \
  --default-volumes-to-restic \
  --restore-volumes
```

#### 4.2.3 备份 schedule

```yaml
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: daily-full-backup
  namespace: mp-infra
spec:
  schedule: "0 3 * * *"  # 每日 03:00 UTC（基础备份后 1 小时）
  template:
    includedNamespaces:
      - mp-platform
      - mp-runtime
      - mp-business
      - mp-ai
      - mp-orchestration
      - mp-integration
      - mp-data
      - mp-monitoring
    excludedResources:
      - pods
      - events
    ttl: 720h  # 30 天
```

### 4.3 关键 PV 备份

#### 4.3.1 必须备份的 PV

| PV 名称 | 命名空间 | 用途 | 备份方式 |
|---|---|---|---|
| `supabase-storage-data` | mp-data | 对象存储底层 | Restic（Velero）每日 |
| `temporal-visibility` | mp-orchestration | Temporal visibility | Restic 每日 |
| `dsh-session-data` | mp-runtime | dsh 会话持久化 | Restic 每日 |
| `grafana-data` | mp-monitoring | Grafana 配置/dashboard | Restic 每日 |

### 4.4 异地对象存储要求

**生产环境必须异地**：

- 主 region：阿里云 / 腾讯云 / 自建 K8s（任一）
- 备份 region：与主 region **不同可用区**（最好不同云厂商）
- 跨 region 复制：每日 04:00 UTC 自动复制 L2 / L3 备份

**异地对象存储配置**：

```hcl
# terraform/backup-storage/<env>/main.tf
resource "aws_s3_bucket" "pg_backup" {
  bucket = "mp-pg-backup-${var.env}"
  region = var.backup_region  # 与生产 region 不同

  versioning {
    enabled = true
  }

  object_lock_configuration {
    object_lock_enabled = "Enabled"
    rule {
      default_retention {
        mode = "COMPLIANCE"
        days = 30
      }
    }
  }

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm     = "aws:kms"
        kms_master_key_id = var.kms_key_id
      }
    }
  }

  lifecycle_rule {
    enabled = true
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
  }
}
```

### 4.5 PITR 恢复流程

#### 4.5.1 恢复步骤

```bash
# 1. 停服务
kubectl scale deployment/supabase-postgres --replicas=0 -n mp-data

# 2. 启动临时实例并恢复
wal-g backup-fetch /tmp/pg-restore \
  --target-time "2026-08-20T10:30:00Z"

# 3. 应用 WAL 到目标时间
echo "restore_command = 'wal-g wal-fetch %f %p'" >> /tmp/pg-restore/postgresql.conf
echo "recovery_target_time = '2026-08-20 10:30:00 UTC'" >> /tmp/pg-restore/postgresql.conf
touch /tmp/pg-restore/recovery.signal

# 4. 启动临时实例（端口 5433）
pg_ctl -D /tmp/pg-restore start -o "-p 5433"

# 5. 验证数据
psql -p 5433 -c "SELECT count(*) FROM public.orders WHERE created_at > '2026-08-20 10:00:00Z';"

# 6. 切换流量
kubectl scale deployment/supabase-postgres --replicas=1 -n mp-data
```

**目标时间**：用户报障时间 - 5 分钟（RPO 兜底）。

#### 4.5.2 恢复计时

| 步骤 | 目标耗时 | 实测上限 |
|---|---|---|
| 1. 停服务 | < 1 分钟 | < 2 分钟 |
| 2. backup-fetch | < 5 分钟 | < 10 分钟 |
| 3. WAL replay | < 10 分钟 | < 15 分钟 |
| 4. 验证数据 | < 5 分钟 | < 10 分钟 |
| 5. 切换流量 | < 1 分钟 | < 2 分钟 |
| **总 RTO** | **< 22 分钟** | **< 30 分钟** |

### 4.6 灾备演练 SOP

**每月 1 日**（北京时间上午 10:00）执行：

```yaml
演练流程（年度 12 次）：
  - 01: 启动 staging 集群从零恢复
  - 02: 模拟 prod 全损，从异地备份恢复 PG 到 staging
  - 03: 计时整个恢复过程
  - 04: 验证 schema / RLS / 关键业务表
  - 05: 写演练报告 evidence/dr-drills/<YYYY-MM>.md
```

**演练报告必须包含**：
- 实测 RPO（数据落后多久）
- 实测 RTO（恢复耗时）
- 发现的 gap + 修复 plan
- 下次演练日期

### 4.7 监控与告警

**Prometheus 指标**：

```promql
# 备份成功
velero_backup_total{status="Success"} > 0

# 最后一次备份时间距今 < 26 小时
time() - velero_backup_last_successful_timestamp < 93600

# WAL 归档 lag < 60 秒
pg_stat_archiver{archived_count} - pg_stat_archiver{last_archived_wal_lsn_age_seconds} < 60
```

**告警规则**：

| 告警 | 阈值 | 路由 |
|---|---|---|
| 备份失败 | 连续 2 次 | Slack #incident-prod |
| 备份缺失 | > 26 小时未成功 | Slack #incident-prod |
| WAL lag | > 5 分钟 | Slack #data-prod |
| 异地复制失败 | 连续 2 次 | Slack #incident-prod + PagerDuty |

### 4.8 备份数据保留与销毁

| 数据类型 | 保留期 | 销毁方式 |
|---|---|---|
| 业务数据 | 业务方定义（默认 7 年）| S3 Lifecycle 自动 Glacier + 删除 |
| 用户 PII | 用户注销后 30 天 | 备份中按 GDPR / 个保法要求匿名化或删除 |
| 备份索引 / metadata | 1 年 | 自动归档 |
| 演练临时数据 | 演练后立即清理 | 手动 delete |

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **可靠性** | RPO ≤ 5 分钟、RTO ≤ 30 分钟（实测上限）|
| **安全性** | 备份数据 AES-256 加密 + 对象锁（不可篡改）|
| **异地** | 跨 region / 跨云厂商 |
| **可观测** | 备份成功率 / lag / 演练报告全部可视化 |
| **可演练** | 每月 1 次，演练报告必须入仓 |
| **成本** | 备份成本 ≤ 数据库实例成本的 30% |

## 6. 接口契约

### 6.1 备份恢复 API（供业务调用）

```bash
# 业务表 Owner 申请 PITR
curl -X POST https://backup-api.mp-platform.local/v1/restore \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "target_time": "2026-08-20T10:30:00Z",
    "tables": ["public.orders"],
    "destination_namespace": "staging-mp-data"
  }'
```

API 由独立服务 `mp-backup-svc`（mp-orchestration namespace）暴露，不在 Foundation-01 范围。

### 6.2 演练报告 schema

```yaml
# evidence/dr-drills/<YYYY-MM>.md 模板
date: 2026-09-01
operator: <name>
cluster: prod
scenario: full-cluster-loss
metrics:
  RPO_actual: <seconds>
  RTO_actual: <seconds>
gaps:
  - description: ...
    severity: high|medium|low
    fix_due: 2026-09-15
signoff:
  sre: ...
  dba: ...
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | WAL 归档开启且实时推送异地 | `pg_stat_archiver` + 异地对象存储列表 |
| AC2 | 每日基础备份成功 | `cron` + 监控告警 |
| AC3 | Velero 安装且每日 schedule 成功 | `velero backup get` |
| AC4 | 异地对象存储启用 KMS 加密 + 对象锁 | terraform apply 输出 |
| AC5 | 首次 PITR 演练报告落地 | `evidence/dr-drills/2026-09.md` |
| AC6 | RPO 实测 ≤ 5 分钟（演练报告）| 演练报告 |
| AC7 | RTO 实测 ≤ 30 分钟（演练报告）| 演练报告 |
| AC8 | 备份监控 + 告警规则上线 | Prometheus 规则 + Alertmanager |
| AC9 | evidence/MP-V6-FOUNDATION-01-ACCEPTANCE.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Supabase Postgres 部署 | foundation-supabase-schema | 必须先 |
| K8s 集群 | foundation-k8s-clusters | 必须先 |
| 异地对象存储（OSS / S3）| 用户 / SRE | 必须先 |
| KMS 密钥 | 用户 / SRE | 必须先 |
| Vault 凭证管理 | foundation-k8s-clusters | 必须先 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| WAL 归档中断 → RPO 扩大 | 数据丢失 | 监控告警 + 立即恢复归档 |
| 异地对象存储故障 | 备份失效 | 多云厂商备份（v6.1 升级）|
| 备份恢复未演练 → 真实故障时不知如何操作 | RTO 失控 | 每月强制演练 |
| 备份数据被加密勒索 | 主备都不可用 | 对象锁 + 异地多版本 |
| Velero / wal-g 版本升级破坏备份 | 备份不可读 | 升级前 dry-run + 保留旧版本备份 |

## 10. 不做（Out of Scope）

- ❌ **跨 region active-active**：v6.0 单 region 写，跨 region 仅用于备份
- ❌ **应用层逻辑备份**（业务 Owner 各自实现）
- ❌ **CDP（Continuous Data Protection）**：v6.1 引入
- ❌ **冷归档到蓝光存储**：v6.0 用 S3 Glacier，物理归档 v7.0 讨论
- ❌ **自动恢复（failover）**：v6.0 仅手动恢复，自动 failover v7.0 讨论

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-rls-policy](foundation-rls-policy.md) / [foundation-networkpolicy](foundation-networkpolicy.md)*