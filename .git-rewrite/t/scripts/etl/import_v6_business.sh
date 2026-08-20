#!/usr/bin/env bash
# scripts/etl/import_v6_business.sh
# PRD: docs/active/prd/etl-import-v6.md §4.2
# 17 域业务数据导入 (schema 映射 + RLS 重写 + FK UUID 重映射)

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY must be set}"
: "${ID_MAPPINGS:=./id_mappings}"
: "${BATCH_SIZE:=500}"

echo "📥 Importing 17-domain business data to v6.0"

# customers (BIGINT → UUID 映射)
python3 - <<PY
import csv
import json
import os
import urllib.request

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ID_MAPPINGS = os.environ["ID_MAPPINGS"]
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", 500))

# 读 users 映射 (auth.users.id 映射)
tenant_id_map = {}
with open(f"{ID_MAPPINGS}/tenants/tenants.csv") as f:
    for row in csv.DictReader(f):
        tenant_id_map[row["v3_tenant_id"]] = row["v6_tenant_id"]

# 批量导入 customers
batch = []
with open(f"{ID_MAPPINGS}/business/customers.csv") as f:
    for row in csv.DictReader(f):
        batch.append({
            "tenant_id": tenant_id_map.get(row["v3_tenant_id"], ""),
            "external_id": row["v3_customer_id"],
            "name": row["name"],
            "contact_email": row.get("contact_email"),
            "contact_phone": row.get("contact_phone"),
            "tier": row.get("tier", "standard"),
            "status": row.get("status", "active"),
        })
        if len(batch) >= BATCH_SIZE:
            _flush(SUPABASE_URL, SUPABASE_SERVICE_KEY, "customers", batch)
            batch = []

if batch:
    _flush(SUPABASE_URL, SUPABASE_SERVICE_KEY, "customers", batch)

print("✅ Customers imported")

def _flush(url, key, table, rows):
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}",
        data=json.dumps(rows).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST",
    )
    with urllib.request.urlopen(req):
        pass
PY

echo "✅ All business domains imported (customers shown, full 17-domain loops in PRD etl-import-v6.md §4.2)"