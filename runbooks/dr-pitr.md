# runbooks/dr-pitr.md
# PRD: docs/active/prd/foundation-dr-backup.md §6
# PITR (Point-in-Time Recovery) SOP
# Target: RPO ≤ 5min, RTO ≤ 22min (dev/staging/prod 通用)

## 触发条件

- 数据误删 / 误改 (业务 / DBA 触发)
- 库损坏 / disk failure
- 跨区域灾难 (异地副本接管)

## 前置检查 (2min)

```bash
# 1. 确认灾备库可达
aws s3 ls "$WALG_S3_PREFIX/basebackups_005/" --region "$AWS_REGION"

# 2. 确认目标 PG 实例 (恢复后启用的实例)
kubectl get pods -n mp-data -l app=supabase-postgres

# 3. 通知 stakeholder
./scripts/notify.sh "DR drill starting" slack
```

## 步骤 1: 停止写入 (1min)

```bash
# 1. 切流量到 maintenance mode (Edge Function / dsh Web / Temporal Worker 都拒绝写入)
kubectl scale deployment -n mp-runtime --replicas=0 -l app=dsh-web
kubectl scale deployment -n mp-orchestration --replicas=0 -l app=temporal-worker

# 2. 等待 in-flight 请求 drain
sleep 30
```

## 步骤 2: 选择恢复点 (1min)

```bash
# 1. 列 base backup
bash scripts/backup/wal-g.sh backup-list | tail -20

# 2. 选择目标时间 (e.g. 2026-08-20 14:00:00 UTC, 用最近一次 backup + replay WAL 到目标时间)
RECOVERY_TARGET_TIME="2026-08-20 14:00:00"
RECOVERY_BASE_BACKUP_LABEL="daily-20260820020000"
```

## 步骤 3: backup-fetch + WAL replay (15min)

```bash
# 1. 备份最新 base backup 到新 PG data dir
NEW_PGDATA="/var/lib/postgresql/data-recovered"
mkdir -p "$NEW_PGDATA"
wal-g backup-fetch "$NEW_PGDATA" "$RECOVERY_BASE_BACKUP_LABEL"

# 2. 配置 recovery.conf / postgresql.auto.conf
cat >> "$NEW_PGDATA/postgresql.auto.conf" <<EOF
restore_command = 'bash /scripts/backup/wal-g.sh fetch %f %p'
recovery_target_time = '$RECOVERY_TARGET_TIME'
recovery_target_action = 'promote'
EOF

# 3. 启动 PG (recovery 模式)
pg_ctl -D "$NEW_PGDATA" start

# 4. 等到 PG promoted (recovery 完成)
while ! pg_isready -h localhost -p 5432 -q; do sleep 5; done
echo "✅ PG recovered to $RECOVERY_TARGET_TIME"
```

## 步骤 4: 数据校验 (2min)

```bash
# 1. 行数对比
psql -c "SELECT count(*) FROM public.tenants WHERE created_at < '$RECOVERY_TARGET_TIME'"
# 与灾备前的备份对比

# 2. 关键业务表 spot check
psql -c "SELECT id, slug, status FROM public.tenants ORDER BY created_at DESC LIMIT 10"

# 3. RLS 验证 (创建临时用户, 跨 tenant 访问被拒)
psql -c "SET ROLE anon; SELECT * FROM public.tenants WHERE id != '...'"  # 期望 0 行
```

## 步骤 5: 切换流量 (1min)

```bash
# 1. 切 DNS / Service endpoint 到新 PG
kubectl apply -n mp-data -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: supabase-postgres-active
spec:
  selector:
    app: supabase-postgres
    version: recovered
  ports:
    - port: 5432
EOF

# 2. 重启依赖服务 (它们会自动 reconnect)
kubectl rollout restart deployment -n mp-runtime -l app=dsh-web
kubectl rollout restart deployment -n mp-orchestration -l app=temporal-worker

# 3. 切回正常 replicas
kubectl scale deployment -n mp-runtime --replicas=3 -l app=dsh-web
kubectl scale deployment -n mp-orchestration --replicas=2 -l app=temporal-worker
```

## 步骤 6: 通知 + 收尾 (1min)

```bash
./scripts/notify.sh "DR drill complete — RTO: $(stat -c %Y /tmp/recovery-start) → $(date +%s)" slack
```

## 月度演练

每月第一个周六 02:00 自动演练（dev 环境）：

```bash
# 触发演练
kubectl create -n mp-data job dr-drill-monthly --from=cronjob/pg-drill-monthly

# 演练结果上报
./scripts/dr-report.sh > evidence/dr-drills/$(date +%Y-%m).md
```

---

*PITR SOP v1.0 — target RTO 22min, RPO 5min. 详见 [foundation-dr-backup.md PRD](../docs/active/prd/foundation-dr-backup.md).*