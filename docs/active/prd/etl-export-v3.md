# PRD：etl-export-v3

> **模块**：v3.0 → v6.0 数据迁移 — 导出阶段
> **对应 Batch**：[MetaPlatform-MIGRATION-01](../batch/MetaPlatform-MIGRATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

把 v3.0 数据库中**4 类基础数据**（用户 / 租户 / 17 域业务 / 审计日志）一次性导出到中间文件（CSV / JSON Lines），为 v6.0 导入阶段提供数据源。

**本 PRD 不包含**：v3.0 业务逻辑代码（已抛弃）；v6.0 schema 设计（已沉淀在 [module-planning spec](../specs/2026-08-19-mp-v6-module-planning.md)）。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- ADR-0060：**完全抛弃 v3.0 代码**，仅 ETL 数据
- v6.0 schema 与 v3.0 **不兼容**（字段映射是单向转换）
- 17 域业务数据在 v3.0 和 v6.0 命名 / 类型 / 约束都不同，必须显式映射

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 4 类数据导出脚本幂等（重复执行结果一致）|
| G2 | 导出数据落**冷存储**（S3 / OSS），不在 v3.0 库停留 |
| G3 | 导出过程对 v3.0 库**只读**（不修改、不锁表超时）|
| G4 | 导出后 v3.0 行数 = 中间文件行数 = 100% 校验通过 |
| G5 | dev / staging / prod 三环境演练通过 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **SRE** | 提供 v3.0 DB 只读访问；导出演练 |
| **后端** | 维护 schema 映射（YAML）；实现导出脚本 |
| **DBA** | 校验导出数据完整性；签名 |
| **合规** | 审计日志归档（S3 Glacier）|

## 4. 功能需求（Functional Requirements）

### 4.1 4 类数据导出范围

| 数据 | 来源（v3.0）| 中间格式 | 数量级（估算）|
|---|---|---|---|
| **用户** | `v3.users` | CSV | 10 万 |
| **租户** | `v3.tenants` | CSV | 1 万 |
| **17 域业务** | 17 张表（见 §4.3）| JSON Lines | 1000 万 / 域 |
| **审计日志** | `v3.audit_logs` | JSON Lines（gzip）| 5 亿 / 年 |

### 4.2 导出脚本位置

```
scripts/etl/
├── export_v3_users.sql
├── export_v3_tenants.sql
├── export_v3_business.sql
├── export_v3_audit_logs.sql
├── schema_mapping.yaml         # 字段映射统一配置
├── run_export.sh               # 统一入口
└── verify_export.sql           # 校验脚本
```

### 4.3 17 域业务数据 schema 映射（schema_mapping.yaml）

```yaml
# v3.0 → v6.0 字段映射（17 域）
domains:
  customer:
    source_table: v3_customers
    target_table: customers
    pk_transform: "BIGINT → UUID（查映射表）"
    fields:
      - { source: customer_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,    target: tenant_id, transform: "INT → UUID" }
      - { source: name,         target: name }
      - { source: email,        target: email }
      - { source: phone,        target: phone }
      - { source: created_at,   target: created_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields:  # v6.0 新增
      - updated_at
      - created_by
      - metadata

  order:
    source_table: v3_orders
    target_table: orders
    pk_transform: "BIGINT → UUID"
    fields:
      - { source: order_id,     target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,    target: tenant_id, transform: "INT → UUID" }
      - { source: customer_id,  target: customer_id, transform: "BIGINT → UUID" }
      - { source: amount,       target: amount, transform: "DECIMAL(18,2) → NUMERIC(18,2)" }
      - { source: status,       target: status, transform: "VARCHAR → TEXT（值保持）" }
      - { source: created_at,   target: created_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields:
      - updated_at
      - idempotency_key

  product:
    source_table: v3_products
    target_table: products
    pk_transform: "BIGINT → UUID"
    fields:
      - { source: product_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,  target: tenant_id, transform: "INT → UUID" }
      - { source: sku,        target: sku }
      - { source: name,       target: name }
      - { source: price,      target: price, transform: "DECIMAL(10,2) → NUMERIC(10,2)" }
      - { source: created_at, target: created_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields:
      - updated_at
      - embedding     # vector(1536) for semantic search

  contract:
    source_table: v3_contracts
    target_table: contracts
    fields:
      - { source: contract_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,   target: tenant_id, transform: "INT → UUID" }
      - { source: customer_id, target: customer_id, transform: "BIGINT → UUID" }
      - { source: amount,      target: amount }
      - { source: signed_at,   target: signed_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields:
      - updated_at
      - status_v6     # v3 状态枚举值映射到 v6

  supplier:
    source_table: v3_suppliers
    target_table: suppliers
    fields:
      - { source: supplier_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,   target: tenant_id, transform: "INT → UUID" }
      - { source: name,        target: name }
      - { source: contact,     target: contact }
    new_fields: [updated_at, metadata]

  inventory:
    source_table: v3_inventory
    target_table: inventory
    fields:
      - { source: inventory_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,    target: tenant_id, transform: "INT → UUID" }
      - { source: product_id,   target: product_id, transform: "BIGINT → UUID" }
      - { source: quantity,     target: quantity }
    new_fields: [updated_at, warehouse_id]

  finance:    # invoices
    source_table: v3_invoices
    target_table: invoices
    fields:
      - { source: invoice_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,  target: tenant_id, transform: "INT → UUID" }
      - { source: order_id,   target: order_id, transform: "BIGINT → UUID" }
      - { source: amount,     target: amount }
      - { source: issued_at,  target: issued_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields: [updated_at, due_date, paid_at]

  expense:
    source_table: v3_expenses
    target_table: expenses
    fields:
      - { source: expense_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,  target: tenant_id, transform: "INT → UUID" }
      - { source: amount,     target: amount }
      - { source: incurred_at, target: incurred_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields: [updated_at, status]

  document:
    source_table: v3_documents
    target_table: documents
    fields:
      - { source: document_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,   target: tenant_id, transform: "INT → UUID" }
      - { source: file_path,   target: storage_path, transform: "本地路径 → Supabase Storage URL" }
      - { source: file_size,   target: size_bytes }
      - { source: content_type, target: mime_type }
    new_fields: [updated_at, embedding_status]

  project:
    source_table: v3_projects
    target_table: projects
    fields:
      - { source: project_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,  target: tenant_id, transform: "INT → UUID" }
      - { source: name,       target: name }
      - { source: started_at, target: started_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields: [updated_at, status, owner_id]

  workflow:
    source_table: v3_workflows
    target_table: workflow_configs
    fields:
      - { source: workflow_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,   target: tenant_id, transform: "INT → UUID" }
      - { source: bpmn_xml,    target: definition, transform: "BPMN XML → Temporal workflow definition" }
    new_fields: [updated_at, version, status]

  approval:
    source_table: v3_approvals
    target_table: hitl_requests
    fields:
      - { source: approval_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,   target: tenant_id, transform: "INT → UUID" }
      - { source: workflow_id, target: workflow_id, transform: "BIGINT → UUID" }
      - { source: status,      target: status, transform: "v3 枚举值 → v6 枚举值" }
    new_fields: [updated_at, hitl_type]   # workflow_saas / workflow_dsh / tool_dsh / action_confirm

  notification:
    source_table: v3_notifications
    target_table: notifications
    fields:
      - { source: notification_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,       target: tenant_id, transform: "INT → UUID" }
      - { source: user_id,         target: recipient_id, transform: "BIGINT → UUID" }
      - { source: message,         target: body }
      - { source: created_at,      target: created_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields: [updated_at, read_at, channel]

  organization:
    source_table: v3_orgs
    target_table: orgs
    fields:
      - { source: org_id,   target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id, target: tenant_id, transform: "INT → UUID" }
      - { source: name,     target: name }
    new_fields: [updated_at, parent_org_id]

  knowledge:
    source_table: v3_articles
    target_table: articles
    fields:
      - { source: article_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id,  target: tenant_id, transform: "INT → UUID" }
      - { source: title,      target: title }
      - { source: content,    target: body }
      - { source: created_at, target: created_at, transform: "DATETIME → TIMESTAMPTZ" }
    new_fields: [updated_at, embedding]  # RAG 用

  analytics:
    source_table: v3_metrics
    target_table: metrics
    fields:
      - { source: metric_id, target: id, transform: "BIGINT → UUID" }
      - { source: tenant_id, target: tenant_id, transform: "INT → UUID" }
      - { source: name,      target: name }
      - { source: value,     target: value }
      - { source: ts,        target: recorded_at, transform: "BIGINT epoch → TIMESTAMPTZ" }
    new_fields: [updated_at, dimensions]
```

### 4.4 导出脚本示例

#### 4.4.1 用户导出

```sql
-- scripts/etl/export_v3_users.sql
COPY (
  SELECT
    id              AS v3_user_id,
    username,
    email,
    password_hash,
    tenant_id       AS v3_tenant_id,
    role,
    created_at,
    last_login_at,
    is_active
  FROM v3.users
  WHERE deleted_at IS NULL
  ORDER BY id
) TO '/tmp/etl/users.csv'
WITH (FORMAT CSV, HEADER, ENCODING 'UTF8');
```

#### 4.4.2 17 域业务导出（用 Python 驱动 schema_mapping.yaml）

```python
# scripts/etl/export_v3_business.py
"""
按 schema_mapping.yaml 导出 17 域业务数据到 JSON Lines
"""
import yaml
import psycopg2
import json
from pathlib import Path

with open('schema_mapping.yaml') as f:
    config = yaml.safe_load(f)

v3_conn = psycopg2.connect(
    host='<v3-readonly-host>',
    port=5432,
    database='mp_v3',
    user='v3_etl_ro',
    password='<from-vault>',
)

out_dir = Path('/tmp/etl/business')
out_dir.mkdir(parents=True, exist_ok=True)

for domain_name, cfg in config['domains'].items():
    src = cfg['source_table']
    target = cfg['target_table']
    out_file = out_dir / f'{target}.jsonl'

    with v3_conn.cursor() as cur, out_file.open('w', encoding='utf-8') as f:
        cur.execute(f'SELECT * FROM {src} ORDER BY id')
        cols = [d.name for d in cur.description]
        count = 0
        for row in cur:
            record = dict(zip(cols, row))
            # 转换字段（按 cfg['fields']）
            mapped = {}
            for field in cfg['fields']:
                mapped[field['target']] = record[field['source']]
            # 添加 v6 新字段默认值
            for new in cfg.get('new_fields', []):
                if new == 'updated_at':
                    mapped[new] = record['created_at']
                elif new == 'tenant_id' and 'tenant_id' not in mapped:
                    mapped[new] = record.get('tenant_id')
                else:
                    mapped[new] = None
            f.write(json.dumps(mapped, default=str, ensure_ascii=False) + '\n')
            count += 1
        print(f'{domain_name}: {count} rows → {out_file}')

v3_conn.close()
```

#### 4.4.3 审计日志归档

```python
# scripts/etl/export_v3_audit_logs.py
"""
审计日志导出 → gzip → 上传到 S3 Glacier
"""
import gzip
import boto3
import psycopg2

s3 = boto3.client('s3')

v3_conn = psycopg2.connect(...)
with v3_conn.cursor() as cur:
    cur.execute("""
        SELECT id, tenant_id, actor_id, action, table_name,
               old_values, new_values, occurred_at
        FROM v3.audit_logs
        WHERE occurred_at >= NOW() - INTERVAL '7 years'
        ORDER BY occurred_at
    """)

    # 流式 gzip 写入（避免内存爆炸）
    with gzip.open('/tmp/etl/audit_logs.jsonl.gz', 'wt', encoding='utf-8') as f:
        for row in cur:
            f.write(json.dumps(dict(zip([d.name for d in cur.description], row)), default=str) + '\n')

# 上传到 S3 Glacier
s3.upload_file(
    '/tmp/etl/audit_logs.jsonl.gz',
    'mp-audit-archive-cold',
    f'audit-logs/{datetime.now().strftime("%Y/%m")}/audit_logs.jsonl.gz',
    ExtraArgs={'StorageClass': 'GLACIER'}
)
```

### 4.5 冷存储上传

```bash
#!/bin/bash
# scripts/etl/run_export.sh
set -euo pipefail

EXPORT_DIR=/tmp/etl
S3_BUCKET=mp-etl-staging

# 1. 用户 / 租户
psql "$V3_DB_URL" -f scripts/etl/export_v3_users.sql
psql "$V3_DB_URL" -f scripts/etl/export_v3_tenants.sql

# 2. 17 域业务
python3 scripts/etl/export_v3_business.py

# 3. 审计日志
python3 scripts/etl/export_v3_audit_logs.py

# 4. 上传到 S3
aws s3 sync "$EXPORT_DIR/" "s3://$S3_BUCKET/v3-export/$(date +%Y%m%d)/" \
    --storage-class STANDARD_IA

echo "Export complete: s3://$S3_BUCKET/v3-export/$(date +%Y%m%d)/"
```

### 4.6 校验脚本

```sql
-- scripts/etl/verify_export.sql
-- 验证 v3.0 行数 = 中间文件行数
WITH counts AS (
    SELECT 'users'     AS dataset, (SELECT COUNT(*) FROM v3.users WHERE deleted_at IS NULL) AS v3_count,
           (SELECT COUNT(*) FROM tmp_users) AS file_count
    UNION ALL
    SELECT 'tenants',   (SELECT COUNT(*) FROM v3.tenants), (SELECT COUNT(*) FROM tmp_tenants)
    UNION ALL
    SELECT 'orders',    (SELECT COUNT(*) FROM v3.orders),  (SELECT COUNT(*) FROM tmp_orders)
    -- ... 17 域
)
SELECT *, CASE WHEN v3_count = file_count THEN '✅' ELSE '❌' END AS status
FROM counts
WHERE v3_count != file_count;
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **幂等性** | 重复执行导出行数一致（idempotent）|
| **只读** | v3.0 库只 SELECT，禁止 UPDATE / DELETE / DDL |
| **冷存储** | 导出文件落 S3 STANDARD_IA 或 Glacier |
| **加密** | S3 启用 SSE-KMS（与 [foundation-dr-backup](foundation-dr-backup.md) 一致）|
| **可观测** | 导出进度 + 行数实时日志；失败告警 |
| **可回滚** | 导出文件保留 90 天（合规）；超期自动 Glacier |
| **演练** | dev / staging 各跑 1 次；prod 演练 1 次 |

## 6. 接口契约

### 6.1 中间文件 schema

**users.csv**：
```csv
v3_user_id,username,email,password_hash,v3_tenant_id,role,created_at,last_login_at,is_active
1,john,john@example.com,$2b$10$...,1,admin,2020-01-01 00:00:00,2024-01-01 12:34:56,true
```

**business/customers.jsonl**：
```json
{"id": "uuid-1", "tenant_id": "uuid-t1", "name": "ACME Corp", "email": "contact@acme.com", "phone": "+86-...", "created_at": "2020-01-01T00:00:00Z", "updated_at": "2020-01-01T00:00:00Z", "metadata": null}
```

**audit_logs.jsonl.gz**：
```json
{"id": 12345, "tenant_id": 1, "actor_id": 100, "action": "INSERT", "table_name": "orders", "old_values": null, "new_values": {"order_id": 9999, ...}, "occurred_at": "2024-01-01T12:34:56Z"}
```

### 6.2 输出位置

```
s3://mp-etl-staging/v3-export/<YYYYMMDD>/
├── users.csv
├── tenants.csv
├── business/
│   ├── customers.jsonl
│   ├── orders.jsonl
│   └── ... (15 个)
└── audit_logs/
    └── <YYYY>/<MM>/audit_logs.jsonl.gz  → Glacier
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 4 个导出脚本写完 | 文件存在 |
| AC2 | dev / staging 演练成功，行数 100% 匹配 | verify_export.sql 输出 |
| AC3 | 中间文件上传到 S3 | `aws s3 ls` |
| AC4 | 17 域 schema_mapping.yaml 完整（17 项）| 文件存在 |
| AC5 | 审计日志归档到 Glacier | `aws s3 ls --storage-class GLACIER` |
| AC6 | v3.0 DB 无任何写入操作（导出后 row count 不变）| DB 校验 |
| AC7 | 导出过程产生 OTel trace（trace 注入 ETL 脚本）| Grafana Tempo |
| AC8 | evidence/MetaPlatform-MIGRATION-01-EXPORT.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| v3.0 DB 只读访问 | SRE 申请 | 启动前 |
| S3 bucket（`mp-etl-staging`） | SRE | 启动前 |
| v6.0 schema 设计 | Sprint 2 沉淀 | 必须先 |
| Vault（DB 凭证） | MetaPlatform-FOUNDATION-01 | 必须先 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| v3.0 DB 性能因导出受影响 | 业务变慢 | 限速（`SET statement_timeout`）+ 业务低峰期跑 |
| 中间文件过大（100GB+）| 存储成本 | S3 STANDARD_IA；超过 90 天 → Glacier |
| schema_mapping 漏字段 | v6.0 数据缺失 | 演练 + 数据对比脚本 + 双重 review |
| 密码 hash 算法不同 | 用户登录失败 | Supabase Auth 支持外部 hash / 强制重置 |
| 审计日志丢失 | 合规风险 | 原始数据保留 7 年（合规要求）|

## 10. 不做（Out of Scope）

- ❌ **业务逻辑迁移**：完全抛弃（ADR-0060）
- ❌ **双写 / 渐进式共存**：禁止
- ❌ **v6.0 兼容 v3.0 schema**：禁止
- ❌ **重写 Python 业务代码**：禁止
- ❌ **Ontology 12 Kernel 数据迁移**：v6.0 重新建模
- ❌ **数字员工 preset 数据迁移**：v6.0 全新

---

*PRD v1.0 — 配套 [etl-import-v6](etl-import-v6.md) / [etl-validation](etl-validation.md) / [foundation-dr-backup](foundation-dr-backup.md) / [foundation-supabase-schema](foundation-supabase-schema.md)*