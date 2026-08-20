#!/usr/bin/env bash
# scripts/etl/export_v3_audit_logs.sh
# PRD: docs/active/prd/etl-export-v3.md §4.4
# 审计日志: 只导出到冷存储 (S3 Glacier), 不进 v6.0 hot DB (合规保留 7y)

set -euo pipefail

: "${V3_PGHOST:?V3_PGHOST must be set}"
: "${V3_PGUSER:?V3_PGUSER must be set}"
: "${V3_PGPASSWORD:?V3_PGPASSWORD must be set}"
: "${V3_PGDATABASE:=mate_platform}"
: "${EXPORT_DIR:=./id_mappings}"
: "${AUDIT_ARCHIVE_BUCKET:=mp-audit-archive-cold}"

mkdir -p "$EXPORT_DIR/audit_logs"

echo "📤 Exporting v3.0 audit_logs → $EXPORT_DIR/audit_logs/audit_logs.csv.gz"

# 按月导出 (避免单文件过大)
for year_month in 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08; do
    OUT="$EXPORT_DIR/audit_logs/audit_logs_${year_month}.csv"

    psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
        -c "\COPY (
            SELECT
                id::text,
                tenant_id::text,
                actor_id::text,
                action,
                schema_name,
                table_name,
                row_pk::text,
                old_values::text,
                new_values::text,
                ip_addr::text,
                user_agent,
                occurred_at::text
            FROM audit_log
            WHERE occurred_at >= '${year_month}-01' AND occurred_at < '${year_month}-01'::date + interval '1 month'
              AND occurred_at < now()
            ORDER BY occurred_at
        ) TO '${OUT}' WITH CSV HEADER"

    # gzip + upload to Glacier
    gzip "$OUT"
    aws s3 cp "${OUT}.gz" "s3://${AUDIT_ARCHIVE_BUCKET}/v3-audit-logs/${year_month}.csv.gz" \
        --storage-class GLACIER \
        --metadata "retention-years=7"

    echo "  ✅ $year_month uploaded"
done

echo "✅ All audit logs exported to s3://${AUDIT_ARCHIVE_BUCKET}/v3-audit-logs/"