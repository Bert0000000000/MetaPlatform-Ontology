#!/usr/bin/env bash
# scripts/etl/import_v6_tenants.sh
# PRD: docs/active/prd/etl-import-v6.md §4.2 (单独 tenants 导入)
# v3.0 → v6.0 tenants 批量

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY must be set (admin role)}"
: "${TENANTS_CSV:=./id_mappings/tenants/tenants.csv}"

echo "📥 Importing tenants to v6.0 Supabase"

python3 - <<PY
import csv
import json
import os
import urllib.request

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TENANTS_CSV = os.environ["TENANTS_CSV"]

count = 0
with open(TENANTS_CSV) as f:
    reader = csv.DictReader(f)
    rows = []
    for r in reader:
        rows.append({
            "id": r["v6_tenant_id"],         # 预生成 UUID, 由 export 时填入
            "name": r["name"],
            "slug": r["slug"],
            "status": r.get("status", "active"),
            "metadata": r.get("metadata") or {},
        })
        # 批量 100 一提交
        if len(rows) >= 100:
            _flush(rows)
            count += len(rows)
            rows = []

    if rows:
        _flush(rows)
        count += len(rows)

print(f"✅ Imported {count} tenants")

def _flush(rows):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/tenants",
        data=json.dumps(rows).encode(),
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "apikey": SUPABASE_SERVICE_KEY,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST",
    )
    with urllib.request.urlopen(req):
        pass
PY