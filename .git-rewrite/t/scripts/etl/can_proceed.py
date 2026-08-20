#!/usr/bin/env python3
"""
scripts/etl/can_proceed.py — 切流量门控
PRD: docs/active/prd/etl-validation.md §5.3
三阶段验证:
  L1 行数对比 (v3=file=v6)
  L2 字段值抽样 (1% 随机 + 5 关键字段 × 17 域)
  L3 Playwright e2e (login + 跨 tenant RLS + audit 触发)
通过 → 允许切流量; 不通过 → 阻塞

用法:
  python3 can_proceed.py --env <dev|staging|prod> --tenant-tier <dev|10pct|1pct|50pct|100pct>
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def http_get(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def http_post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={**headers.headers, "Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def check_l1_row_counts(supabase_url: str, supabase_key: str, v3_dsn: str) -> dict:
    """L1: 行数对比"""
    # 简化示例: 5 张表对比
    # 实际生产: 用 v3 psql + v6 Supabase RPC 拉 count
    tables = ["tenants", "customers", "orders", "contracts", "products"]
    results = {}
    for table in tables:
        # v6 count via Supabase REST
        headers = {"Authorization": f"Bearer {supabase_key}", "apikey": supabase_key}
        v6_count_resp = http_get(
            f"{supabase_url}/rest/v1/{table}?select=id",
            headers,
        )
        # v6_count_resp 是数组; 用 psycopg 拿 v3 count
        # (简化: 这里假设 v3 DSN 提供)
        # 实际: pg8000 + DSN
        results[table] = {
            "v6_count": len(v6_count_resp) if isinstance(v6_count_resp, list) else None,
            "v3_count": None,  # 留给 psql 调用
            "match": None,    # 等 v3 count 后判断
        }
    return results


def check_l2_field_samples(supabase_url: str, supabase_key: str, sample_rate: float = 0.01) -> dict:
    """L2: 1% 随机抽样 + 5 关键字段"""
    # 实际: 5 字段 × 17 域 = 85 点, 通过率需 >= 99%
    return {"sampled": 85, "passed": 0, "pass_rate":": 0.0, "threshold": 0.99}


def check_l3_e2e(supabase_url: str, supabase_key: str) -> dict:
    """L3: Playwright e2e (login + RLS + audit trigger)"""
    # 实际: Playwright 跑 3 个场景
    # - login with v3 password hash
    # - 跨 tenant 访问被拒
    # - audit_log 触发器记录写入
    return {"scenarios_run": 0, "passed": 0, "pass_rate":": 0.0, "threshold": 1.0}


def gate_decision(l1: dict, l2: dict, l3: dict) -> dict:
    """综合判断是否可以切流量"""
    l1_ok = all(r.get("match") for r in l1.values())
    l2_ok = l2["pass_rate"] >= l2["threshold"]
    l3_ok = l3["pass_rate"] >= l3["threshold"]

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "l1_passed": l1_ok,
        "l2_passed": l2_ok,
        "l3_passed": l3_ok,
        "overall": "PROCEED" if (l1_ok and l2_ok and l3_ok) else "BLOCKED",
        "details": {"l1": l1, "l2": l2, "l3": l3},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--tenant-tier", required=True, choices=["dev", "10pct", "1pct", "50pct", "100pct"])
    parser.add_argument("--output", default=None, help="Write JSON report to file")
    args = parser.parse_args()

    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_KEY"]
    v3_dsn = os.environ.get("V3_DSN", "")

    print(f"🚦 can_proceed check: env={args.env} tier={args.tenant_tier}")

    l1 = check_l1_row_counts(supabase_url, supabase_key, v3_dsn)
    l2 = check_l2_field_samples(supabase_url, supabase_key)
    l3 = check_l3_e2e(supabase_url, supabase_key)

    decision = gate_decision(l1, l2, l3)
    print(f"\n{'✅ PROCEED' if decision['overall'] == 'PROCEED' else '❌ BLOCKED'}")
    print(json.dumps(decision, indent=2))

    if args.output:
        Path(args.output).write_text(json.dumps(decision, indent=2))
        print(f"\n📄 Report written to {args.output}")

    sys.exit(0 if decision["overall"] == "PROCEED" else 1)


if __name__ == "__main__":
    main()