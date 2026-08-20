#!/usr/bin/env bash
# scripts/etl/export_v3_tenants.sh
# PRD: docs/active/prd/etl-export-v3.md §4.2

set -euo pipefail

: "${V3_PGHOST:?V3_PGHOST must be set}"
: "${V3_PGUSER:?V3_PGUSER must be set}"
: "${V3_PGPASSWORD:?V3_PGPASSWORD must be set}"
: "${V3_PGDATABASE:=mate_platform}"
: "${EXPORT_DIR:=./id_mappings}"

mkdir -p "$EXPORT_DIR/tenants"

echo "📤 Exporting v3.0 tenants → $EXPORT_DIR/tenants/tenants.csv"

psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
    -c "\COPY (
        SELECT
            id::text              AS v3_tenant_id,
            slug,
            name,
            status,
            metadata::text,
            created_at::text      AS v3_created_at,
            updated_at::text      AS v3_updated_at,
            gen_random_uuid()::text AS v6_tenant_id
        FROM tenants
        WHERE status != 'archived'
    ) TO '${EXPORT_DIR}/tenants/tenants.csv' WITH CSV HEADER"

ROWS=$(wc -l < "${EXPORT_DIR}/tenants/tenants.csv")
echo "✅ Exported $((ROWS - 1)) tenants"