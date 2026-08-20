#!/usr/bin/env bash
# scripts/etl/export_v3_users.sh
# PRD: docs/active/prd/etl-export-v3.md §4.1
# 从 v3.0 PG 导出 users → CSV (含 password_hash, 由 Supabase Auth import 接管)
#
# 运行时机: 在 ETL 切流量前 24h (一次)
# 输出: id_mappings/users.csv

set -euo pipefail

# 凭证 (由 Vault / ExternalSecret 注入, 不进 git)
: "${V3_PGHOST:?V3_PGHOST must be set}"
: "${V3_PGUSER:?V3_PGUSER must be set (v3.0 readonly user)}"
: "${V3_PGPASSWORD:?V3_PGPASSWORD must be set}"
: "${V3_PGDATABASE:=mate_platform}"
: "${EXPORT_DIR:=./id_mappings}"

mkdir -p "$EXPORT_DIR/users"

echo "📤 Exporting v3.0 users → $EXPORT_DIR/users/users.csv"

psql "postgresql://${V3_PGUSER}:${V3_PGPASSWORD}@${V3_PGHOST}/${V3_PGDATABASE}" \
    -c "\COPY (
        SELECT
            id::text              AS v3_user_id,
            tenant_id::text       AS v3_tenant_id,
            email,
            password_hash,
            display_name,
            role,
            status,
            created_at::text      AS v3_created_at,
            updated_at::text      AS v3_updated_at,
            -- v3 →  → v6 ID 映射 (这里 v6 UUID 由 import 阶段生成)
            gen_random_uuid()::text AS v6_user_id
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY id
    ) TO '${EXPORT_DIR}/users/users.csv' WITH CSV HEADER"

# 行数校验
ROWS=$(wc -l < "${EXPORT_DIR}/users/users.csv")
echo "✅ Exported $((ROWS - 1)) users (excluding header) to $EXPORT_DIR/users/users.csv"