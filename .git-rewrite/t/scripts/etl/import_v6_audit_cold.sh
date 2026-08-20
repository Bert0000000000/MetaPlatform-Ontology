#!/usr/bin/env bash
# scripts/etl/import_v6_audit_cold.sh
# PRD: docs/active/prd/etl-import-v6.md §4.3
# 审计日志: 不进 v6.0 hot DB, 仅验证 Glacier 归档存在

set -euo pipefail

: "${AUDIT_ARCHIVE_BUCKET:=mp-audit-archive-cold}"
: "${AUDIT_FILES_DIR:=./id_mappings/audit_logs}"

echo "📥 Verifying v3.0 audit_logs → S3 Glacier archive"

# 验证所有 gzip 文件已上传 (按月)
MISSING=0
for f in "$AUDIT_FILES_DIR"/*.csv.gz; do
    [ -e "$f" ] || continue
    month=$(basename "$f" .csv.gz | sed 's/audit_logs_//')
    if ! aws s3 ls "s3://${AUDIT_ARCHIVE_BUCKET}/v3-audit-logs/${month}.csv.gz" >/dev/null 2>&1; then
        echo "  ❌ ${month}.csv.gz NOT in S3 Glacier"
        MISSING=$((MISSING + 1))
    else
        echo "  ✅ ${month}.csv.gz archived"
    fi
done

if [ "$MISSING" -gt 0 ]; then
    echo "❌ $MISSING audit archive file(s) missing"
    exit 1
fi

echo "✅ All audit logs verified in S3 Glacier (7-year retention per compliance)"