# Runbook：Supabase PG 备份与恢复

> **适用**：Supabase Postgres 生产集群（PITR 失败 / RPO 超标 / 灾难恢复演练）
> **严重度**：P0（数据丢失风险）
> **负责人**：SRE + DBA
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **PITR 恢复** | 用户误删表 / 删数据 | §3.1 |
| **RPO 超标** | WAL lag > 5 分钟告警 | §3.2 |
| **备份失败** | 连续 2 次基础备份失败 | §3.3 |
| **异地复制失败** | 跨 region 同步失败 | §3.4 |
| **全损恢复** | 生产集群彻底挂掉 | §3.5 |
| **月度演练** | 每月 1 日定期 | §3.6 |

---

## 2. 前置检查

```bash
# 1. 确认环境
ENV=prod
POD=$(kubectl get pod -n mp-data -l app=supabase-postgres -o jsonpath='{.items[0].metadata.name}')
echo "Target pod: $POD"

# 2. 查看备份状态
velero backup get -n mp-infra | head -10

# 3. 查看最后一次成功备份
velero backup get -n mp-infra --output json | jq '.items[] | select(.status.phase=="Completed") | .metadata.name' | head -3

# 4. 查看 WAL 归档 lag
psql -h $SUPABASE_HOST -U supabase_admin -c "
SELECT
  pg_current_wal_lsn() AS current_lsn,
  pg_last_wal_receive_lsn() AS receive_lsn,
  pg_last_wal_replay_lsn() AS replay_lsn,
  EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()) AS replay_lag_seconds
"

# 5. 查看异地复制状态
aws s3 ls s3://mp-pg-backup-prod-<backup-region>/ --recursive | tail -5
```

---

## 3. 故障 SOP

### 3.1 PITR 恢复（用户误删数据）

**步骤**：

```bash
# Step 1: 停写入（保留读，避免覆盖）
kubectl exec -n mp-data $POD -- psql -c "
ALTER SYSTEM SET default_transaction_read_only = on;
SELECT pg_reload_conf();
"

# Step 2: 记录目标恢复时间（用户报障时间 - 5 分钟）
TARGET_TIME="2026-08-20 10:30:00 UTC"

# Step 3: 创建临时实例 + 恢复到目标时间
kubectl exec -n mp-data $POD -- bash -c "
mkdir -p /tmp/pitr-restore
wal-g backup-fetch /tmp/pitr-restore --target-time '$TARGET_TIME'

# 改配置启用 recovery
cat >> /tmp/pitr-restore/postgresql.conf <<EOF
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'pause'
EOF
touch /tmp/pitr-restore/recovery.signal
"

# Step 4: 启动临时实例（端口 5433）
kubectl exec -n mp-data $POD -- bash -c "
pg_ctl -D /tmp/pitr-restore start -o '-p 5433' -l /tmp/pitr-restore.log
sleep 10
psql -p 5433 -c 'SELECT now();'
"

# Step 5: 验证数据（不要导出到生产前先验证）
kubectl exec -n mp-data $POD -- psql -p 5433 -c "
SELECT count(*) FROM public.orders WHERE created_at > '$TARGET_TIME'::timestamptz - interval '1 hour';
"

# Step 6: pg_dump 误删的表 / 数据
kubectl exec -n mp-data $POD -- bash -c "
pg_dump -p 5433 -t public.<table_name> --data-only | psql -p 5432
"

# Step 7: 停临时实例，恢复写入
kubectl exec -n mp-data $POD -- bash -c "
pg_ctl -D /tmp/pitr-restore stop
psql -c 'ALTER SYSTEM RESET default_transaction_read_only;'
psql -c 'SELECT pg_reload_conf();'
"
```

**验证清单**：

- [ ] 误删数据已恢复
- [ ] 业务应用重新可用（kubectl rollout restart deployment/<app> -n mp-xxx）
- [ ] 写 audit_log 记录本次恢复操作

### 3.2 WAL lag 超标

```bash
# 1. 检查归档状态
psql -c "SELECT * FROM pg_stat_archiver;"

# 2. 如果 archive_mode = off
psql -c "ALTER SYSTEM SET archive_mode = on;"
psql -c "SELECT pg_reload_conf();"

# 3. 重启 PG 让 archive_mode 生效
kubectl rollout restart deployment/supabase-postgres -n mp-data
kubectl wait --for=condition=ready pod -l app=supabase-postgres -n mp-data --timeout=300s

# 4. 检查 wal-g 进程
kubectl logs -n mp-data $POD --previous | grep wal-g | tail -20

# 5. 手动触发归档
psql -c "SELECT pg_switch_wal();"

# 6. 5 分钟后再次检查 lag
sleep 300
psql -c "SELECT EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp());"
```

### 3.3 基础备份失败

```bash
# 1. 查 cron 日志
kubectl logs -n mp-data $POD --previous | grep -i backup

# 2. 手动触发备份
kubectl exec -n mp-data $POD -- bash -c "
export \$(cat /opt/supabase/backup/wal-g.env | xargs)
wal-g backup-push --full /var/lib/postgresql/data
"

# 3. 查错误
kubectl logs -n mp-data $POD --previous 2>&1 | tail -50

# 4. 常见原因：
# - 磁盘满：df -h /var/lib/postgresql
# - 凭证失效：检查 Vault 中的 WALG_S3_PREFIX
# - 网络问题：ping s3.<region>.amazonaws.com

# 5. 修复后再次触发
```

### 3.4 异地复制失败

```bash
# 1. 检查复制状态
aws s3api get-bucket-replication --bucket mp-pg-backup-prod

# 2. 看复制失败的 object
aws s3api list-object-versions --bucket mp-pg-backup-prod --query "Versions[?IsLatest].[Key, LastModified]" | head -10

# 3. 重新触发复制
aws s3api put-bucket-replication --bucket mp-pg-backup-prod \
  --replication-configuration file://replication.json

# 4. 验证
aws s3 ls s3://mp-pg-backup-prod-<backup-region>/wal/ --recursive | tail -5
```

### 3.5 全损恢复（IaC + PITR）

```bash
# 1. 重建 K8s 集群（按 foundation-k8s-clusters IaC）
cd terraform/cluster/prod
terraform apply -auto-approve

# 2. 部署 Supabase Helm
helm install supabase mp-helm/supabase -n mp-data --create-namespace \
  --values helm/mp-umbrella/values-prod.yaml

# 3. 等待 PG pod ready
kubectl wait --for=condition=ready pod -l app=supabase-postgres -n mp-data --timeout=600s

# 4. PITR 恢复（target = 最近一次成功的备份时间）
# 详见 §3.1 PITR 步骤 3-7

# 5. 验证 RLS / 租户数据
psql -c "SELECT count(*) FROM public.tenants;"
psql -c "SELECT count(*) FROM public.profiles;"

# 6. 重启所有应用 deployment
for ns in mp-platform mp-runtime mp-business mp-ai mp-orchestration mp-data; do
  kubectl rollout restart deployment -n $ns
done

# 7. 监控 30 分钟
watch -n 30 'kubectl get pods -A | grep -v Running'
```

### 3.6 月度演练 SOP

```bash
# 在 staging 集群执行（不在 prod！）
ENV=staging

# 1. 启动演练
echo "=== DR Drill Start: $(date) ==="
echo "Operator: $OPERATOR_NAME"
echo "Scenario: full-cluster-loss"

# 2. 模拟 prod 全损
# （在 staging 集群，故意破坏 supabase-postgres pod）
# kubectl delete pod -n mp-data -l app=supabase-postgres --grace-period=0 --force

# 3. 触发恢复（按 §3.5 步骤）

# 4. 计时
START=$(date +%s)
# ... 恢复过程 ...
END=$(date +%s)
DURATION=$((END - START))

# 5. 校验数据
EXPECTED_TENANTS=10234
ACTUAL=$(psql -c "SELECT count(*) FROM public.tenants;" | tail -3 | head -1 | tr -d ' ')
if [ "$ACTUAL" -eq "$EXPECTED_TENANTS" ]; then
  echo "✅ Tenants count match"
else
  echo "❌ Tenants count mismatch: expected=$EXPECTED_TENANTS actual=$ACTUAL"
fi

# 6. 写演练报告
cat > evidence/dr-drills/$(date +%Y-%m).md <<EOF
date: $(date +%Y-%m-%d)
operator: $OPERATOR_NAME
cluster: $ENV
scenario: full-cluster-loss
metrics:
  RPO_actual: <seconds>
  RTO_actual: $DURATION
  data_consistency: PASS|FAIL
gaps:
  - <发现的问题>
fix_due: <修复截止日期>
signoff:
  sre: <name>
  dba: <name>
EOF
```

---

## 4. 回滚步骤

如果 PITR 恢复后**新数据丢失**（恢复到时间点 A，但 A 之后用户写了新数据）：

```bash
# 1. 立即停止写入
kubectl exec -n mp-data $POD -- psql -c "ALTER SYSTEM SET default_transaction_read_only = on;"

# 2. 看是否有更新的备份（pg_basebackup 之后还有 WAL）
LATEST_BACKUP=$(velero backup get -n mp-infra --output json | jq -r '.items[] | select(.status.phase=="Completed") | .metadata.name' | head -1)
echo "Latest backup: $LATEST_BACKUP"

# 3. 恢复到比当前更近的时间点
# 重复 §3.1 步骤，TARGET_TIME 改为当前时间 - 1 分钟

# 4. 业务影响评估
# - 期间写入的数据可能丢失
# - 需要通知业务方
```

---

## 5. 升级检查表

每月例行：

- [ ] WAL 归档 lag < 60 秒
- [ ] 基础备份成功率 = 100%（过去 30 天）
- [ ] Velero 备份成功率 ≥ 95%
- [ ] 异地复制延迟 < 24 小时
- [ ] KMS 密钥轮换（年度）
- [ ] wal-g 版本升级（季度）

---

## 6. 联系人 / 升级路径

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（数据丢失风险）| SRE Lead + DBA Lead | Slack #incident-prod + PagerDuty + 邮件 CEO |
| P1（备份失败）| SRE | Slack #ops-prod |
| P2（RPO 超标）| SRE | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: foundation-dr-backup](../prd/foundation-dr-backup.md)*