#!/usr/bin/env bash
# scripts/backup/wal-g.sh
# PRD: docs/active/prd/foundation-dr-backup.md §4.1
# WAL archiving via wal-g → S3 (KMS 加密 + object-lock + Glacier 90d 后)
#
# 凭证从 ExternalSecret 注入到 env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY);
# S3_BUCKET / KMS_KEY_ID 通过 K8s ConfigMap 注入.
#
# 运行时机: 由 PG sidecar (pg-wal-archive container) 持续调用
# 或通过 K8s CronJob 每分钟检测未归档 WAL 段.
#
# 用法: wal-g.sh <push|fetch|backup-list|restore>

set -euo pipefail

# 必填环境变量 (由 K8s Pod 注入, 不进 git)
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX (e.g. s3://mp-pg-backup-prod/wal-g) must be set}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID must be set}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY must be set}"
: "${AWS_REGION:?AWS_REGION must be set (e.g. cn-north-1)}"
: "${PGDATA:?PGDATA must be set to PG data directory}"

# 可选 (with defaults)
WALG_DELTA_MAX_STEPS=${WALG_DELTA_MAX_STEPS:-5}
WALG_COMPRESSION_METHOD=${WALG_COMPRESSION_METHOD:-lz4}
WALG_LIBSODIUM_KEY=${WALG_LIBSODIUM_KEY:-}  # 静态加密 key, 也可走 Vault

ACTION="${1:-push}"

echo "🗄️  wal-g $ACTION  prefix=$WALG_S3_PREFIX  region=$AWS_REGION  pgdata=$PGDATA"

case "$ACTION" in
    push)
        # 推送当前 WAL 段到 S3
        exec wal-g wal-push "$PGDATA"
        ;;

    fetch)
        # 从 S3 拉取 WAL 段 (PITR 时使用)
        TARGET_WAL="${2:?usage: wal-g.sh fetch <WAL-segment-name>}"
        exec wal-g wal-fetch "$TARGET_WAL" "$PGDATA"
        ;;

    backup-list)
        # 列出所有 base backup
        exec wal-g backup-list
        ;;

    backup-push)
        # 推 base backup (由 pg_basebackup-daily.sh 调)
        exec wal-g backup-push "$PGDATA"
        ;;

    *)
        echo "usage: wal-g.sh <push|fetch|backup-list|backup-push> [wal-segment]"
        exit 2
        ;;
esac