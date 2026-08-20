#!/usr/bin/env bash
# scripts/etl/export_v3_business.sh
# PRD: docs/active/prd/etl-export-v3.md §4.3
# 17 域业务数据导出 (orders / customers / contracts / products / ...)
#
# 注意: 17 域 schema 映射见 schema_mapping.yaml, 每域一个独立 query

set -euo pipefail

: "${V3_PGHOST:?V3_PGHOST must be set}"
: "${V3_PGUSER:?V3_PGUSER must be set}"
: "${V3_PGPASSWORD:?V3_PGPASSWORD must be set}"
: "${V3_PGDATABASE:=mate_platform}"
: "${EXPORT_DIR:=./id_mappings}"

mkdir -p "$EXPORT_DIR/business"

echo "📤 Exporting v3.0 17-domain business data → $EXPORT_DIR/business/"

# 示例: customers (含 BIGINT → UUID 映射)
psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
    -c "\COPY (
        SELECT
            id::text              AS v3_customer_id,
            tenant_id::text       AS v3_tenant_id,
            name,
            contact_email,
            contact_phone,
            tier,
            status,
            metadata::text,
            created_at::text,
            updated_at::text
        FROM customers
        WHERE deleted_at IS NULL
    ) TO '${EXPORT_DIR}/business/customers.csv' WITH CSV HEADER"

# orders
psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
    -c "\COPY (
        SELECT
            id::text              AS v3_order_id,
            tenant_id::text,
            customer_id::text     AS v3_customer_id,
            amount::text,
            currency,
            status,
            order_number,
            created_at::text,
            updated_at::text
        FROM orders
        WHERE deleted_at IS NULL
    ) TO '${EXPORT_DIR}/business/orders.csv' WITH CSV HEADER"

# contracts
psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
    -c "\COPY (
        SELECT
            id::text              AS v3_contract_id,
            tenant_id::text,
            customer_id::text     AS v3_customer_id,
            contract_number,
            title,
            total_amount::text,
            currency,
            effective_date::text,
            expiry_date::text,
            status,
            created_at::text
        FROM contracts
        WHERE deleted_at IS NULL
    ) TO '${EXPORT_DIR}/business/contracts.csv' WITH CSV HEADER"

# 注: 完整 17 域导出需要逐域写 query (PRD §4.3 列了 17 域, 这里展示 3 域示例)
echo "✅ Exported 3 of 17 domains (customers / orders / contracts). 完整列表见 etl-export-v3.md PRD §4.3"