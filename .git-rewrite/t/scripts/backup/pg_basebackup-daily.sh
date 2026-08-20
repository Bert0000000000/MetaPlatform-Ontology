#!/usr/bin/env bash
# scripts/backup/pg_basebackup-daily.sh
# PRD: docs/active/prd/foundation-dr-backup.md §4.2
# 每日 base backup: pg_basebackup → wal-g backup-push → S3
# K8s CronJob 调度 (每天 02:00 prod / 04:00 staging / dev 不调度)
#
# 保留: 30 天 (本地 retention); 90 天后转 Glacier (S3 lifecycle policy)
# RPO ≤ 5 分钟 (WAL 持续归档); RTO ≤ 30 分钟 (PITR)

set -euo pipefail

# 必填环境变量 (K8s CronJob 注入)
: "${PGHOST:?PGHOST must be set (Supabase PG Cluster IP)}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER must be set (e.g. postgres or backup_user)}"
: "${PGPASSWORD:?PGPASSWORD must be set (from Vault)}"
: "${PGDATABASE:=postgres}"
: "${BACKUP_LABEL:?BACKUP_LABEL must be set (e.g. daily-$(date +%Y%m%d))}"

ENV="${BACKUP_ENV:-dev}"  # dev | staging | prod
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOCAL_BACKUP_DIR="/var/lib/pgbackups/${ENV}/${TIMESTAMP}"

echo "📦 pg_basebackup-daily  env=$ENV  ts=$TIMESTAMP  label=$BACKUP_LABEL"

mkdir -p "$LOCAL_BACKUP_DIR"

# 1. pg_basebackup → 本地目录
pg_basebackup \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --pgdata="$LOCAL_BACKUP_DIR" \
    --format=tar \
    --gzip \
    --compress=6 \
    --wal-method=stream \
    --checkpoint=fast \
    --label="$BACKUP_LABEL" \
    --no-password \
    --verbose

# 2. wal-g backup-push (可选, 直接传 PG 数据目录)
WALG_S3_PREFIX="${WALG_S3_PREFIX:-s3://mp-pg-backup-${ENV}/wal-g}" \
WALG_DELTA_MAX_STEPS=5 \
WALG_COMPRESSION_METHOD=lz4 \
    bash "$(dirname "$0")/wal-g.sh" backup-push

# 3. 清理本地 (保留最近 3 天)
find /var/lib/pgbackups/"$ENV" -maxdepth 1 -mindepth 1 -type d -mtime +3 -exec rm -rf {} +

echo "✅ pg_basebackup-daily complete: $BACKUP_LABEL"
echo "   S3 path: $WALG_S3_PREFIX/basebackups_005/$BACKUP_LABEL/"

# 4. 上报 OTel metric (简化 — 用 curl 打 metrics endpoint)
if [ -n "${OTEL_METRICS_ENDPOINT:-}" ]; then
    curl -sS -X POST "$OTEL_METRICS_ENDPOINT" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"pg_basebackup.success\",\"value\":1,\"labels\":{\"env\":\"$ENV\",\"label\":\"$BACKUP_LABEL\"}}" \
        || true
fi