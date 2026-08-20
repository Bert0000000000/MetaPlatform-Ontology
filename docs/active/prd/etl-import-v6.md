# PRD：etl-import-v6

> **模块**：v3.0 → v6.0 数据迁移 — 导入阶段
> **对应 Batch**：[MetaPlatform-MIGRATION-01](../batch/MetaPlatform-MIGRATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：后端 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

把 [etl-export-v3](etl-export-v3.md) 导出的 4 类中间文件导入到 v6.0 Supabase：
- 用户 → Supabase Auth + 业务 `profiles` 表
- 租户 → `public.tenants`
- 17 域业务数据 → 各业务 schema
- 审计日志 → S3 冷存储（**不导入热库**）

按租户**分批切流量**（dev → staging → 10% → 1% canary → 50% → 100%），全量切完 v3.0 标记 deprecated。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 → v6.0 schema 不兼容（见 [etl-export-v3](etl-export-v3.md) §4.3）
- 19 应用全部基于 v6.0 schema，**导入错误会导致所有应用功能故障**
- 必须按租户分批切流量，每批 24h 监控

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 导入脚本幂等（重复执行结果一致；UPDATE ON CONFLICT）|
| G2 | 用户密码迁移 Supabase Auth 支持 |
| G3 | 17 域业务数据 100% 导入 + RLS 自动应用 |
| G4 | 审计日志仅归档冷存储，不导入 v6.0 库 |
| G5 | 按租户分批切流量，4-6 周完成 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **业务 Owner** | 触发租户切流量；监控 v6.0 应用 |
| **后端** | 实现导入脚本；处理 schema 冲突 |
| **SRE** | 监控导入进度；故障响应；触发回滚 |
| **DBA** | 校验导入数据完整性 |

## 4. 功能需求（Functional Requirements）

### 4.1 4 类数据导入脚本

```
scripts/etl/
├── import_v6_users.py          # 用户 → Supabase Auth + profiles
├── import_v6_tenants.py        # 租户 → public.tenants
├── import_v6_business.py       # 17 域 → 各业务 schema
├── import_v6_audit_cold.py     # 审计日志 → 确认已归档（仅校验）
├── run_import.sh               # 统一入口
└── id_mapping/                 # BIGINT → UUID 映射表
    ├── tenants.csv
    ├── users.csv
    └── ...
```

### 4.2 用户导入

```python
# scripts/etl/import_v6_users.py
"""
导入用户到 Supabase Auth + profiles 表
"""
import csv
from supabase import create_client

SUPABASE_URL = "https://xxx.supabase.co"
SERVICE_KEY = "<from-vault>"

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

# 1. 读取 CSV
with open('/tmp/etl/users.csv') as f:
    users = list(csv.DictReader(f))

# 2. 批量创建 Supabase Auth 用户
BATCH_SIZE = 100
for i in range(0, len(users), BATCH_SIZE):
    batch = users[i:i+BATCH_SIZE]
    print(f'Importing users {i}-{i+len(batch)}/{len(users)}')

    for u in batch:
        try:
            # Supabase Auth 支持外部 hash
            result = supabase.auth.admin.create_user({
                "email": u["email"],
                "password_hash": u["password_hash"],
                "email_confirm": True,
                "user_metadata": {
                    "v3_user_id": int(u["v3_user_id"]),
                    "v3_tenant_id": int(u["v3_tenant_id"]),
                    "role": u["role"],
                    "imported_at": "2026-MM-DD",
                }
            })
            new_user_id = result.user.id

            # 3. 写 profiles 表（含 tenant_id）
            supabase.from_('profiles').upsert({
                'id': new_user_id,
                'tenant_id': uuid_mapping[int(u["v3_tenant_id"])],
                'email': u["email"],
                'display_name': u["username"],
                'role': map_role(u["role"]),  # v3 → v6 角色映射
                'metadata': {'v3_user_id': int(u["v3_user_id"])},
            }).execute()

            # 4. 保存 id 映射（用于后续业务数据导入）
            id_mapping.append((int(u["v3_user_id"]), new_user_id))

        except Exception as e:
            print(f'Failed to import user {u["email"]}: {e}')
            raise

# 5. 持久化 id 映射表
with open('id_mapping/users.csv', 'w') as f:
    w = csv.writer(f)
    w.writerow(['v3_user_id', 'v6_user_id'])
    w.writerows(id_mapping)

print(f'Imported {len(users)} users')
```

**关键点**：
- Supabase Auth 支持外部 password hash（bcrypt、Argon2 等），无需强制重置
- 如果 v3.0 hash 算法不被 Supabase 支持，则**强制重置**（下次登录走"忘记密码"流程）
- `id_mapping/users.csv` 必须持久化，用于业务数据导入时的 `customer_id` / `user_id` 转换

### 4.3 租户导入

```python
# scripts/etl/import_v6_tenants.py
import yaml
import csv
from supabase import create_client

with open('schema_mapping.yaml') as f:
    config = yaml.safe_load(f)

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

with open('/tmp/etl/tenants.csv') as f:
    tenants = list(csv.DictReader(f))

id_mapping = []
for t in tenants:
    # v6.0 tenant 必须有 slug（URL 友好）
    slug = generate_slug(t['name'])

    result = supabase.from_('tenants').upsert({
        'id': uuid.uuid4(),  # 重新生成
        'slug': slug,
        'name': t['name'],
        'status': 'active' if t['is_active'] else 'archived',
        'metadata': {
            'v3_tenant_id': int(t['tenant_id']),
            'imported_at': '2026-MM-DD',
        },
    }, on_conflict='slug').execute()

    id_mapping.append((int(t['tenant_id']), result.data[0]['id']))

# 保存租户映射
with open('id_mapping/tenants.csv', 'w') as f:
    w = csv.writer(f)
    w.writerow(['v3_tenant_id', 'v6_tenant_id'])
    w.writerows(id_mapping)
```

### 4.4 17 域业务数据导入

```python
# scripts/etl/import_v6_business.py
"""
按 schema_mapping.yaml 导入 17 域业务数据
"""
import yaml
import json
from pathlib import Path
from supabase import create_client

with open('schema_mapping.yaml') as f:
    config = yaml.safe_load(f)

# 加载 id 映射
id_mappings = {}
for domain_name in config['domains']:
    # 实际应按表名读
    pass

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

for domain_name, cfg in config['domains'].items():
    target = cfg['target_table']
    in_file = Path(f'/tmp/etl/business/{target}.jsonl')

    print(f'Importing {target}...')

    BATCH_SIZE = 500
    batch = []
    total = 0
    with in_file.open('r', encoding='utf-8') as f:
        for line in f:
            record = json.loads(line)
            # 转换外键：BIGINT → UUID
            for key in ['tenant_id', 'customer_id', 'user_id', 'order_id']:
                if key in record and isinstance(record[key], int):
                    record[key] = id_mappings.get(key, {}).get(record[key])
            batch.append(record)
            if len(batch) >= BATCH_SIZE:
                supabase.from_(target).upsert(batch).execute()
                total += len(batch)
                batch = []
        if batch:
            supabase.from_(target).upsert(batch).execute()
            total += len(batch)

    print(f'  {target}: {total} rows')
```

### 4.5 审计日志（仅校验）

```python
# scripts/etl/import_v6_audit_cold.py
"""
审计日志已由 export 阶段归档到 Glacier，本脚本仅做校验：
1. 确认 S3 上文件存在
2. 校验行数与 v3.0 一致
3. 不导入 v6.0 库（合规要求保留 7 年）
"""
import boto3

s3 = boto3.client('s3')

# 校验文件存在
try:
    s3.head_object(Bucket='mp-audit-archive-cold',
                   Key=f'audit-logs/{YYYY}/{MM}/audit_logs.jsonl.gz')
    print('✅ Audit log archive exists')
except s3.exceptions.NoSuchKey:
    raise SystemExit('❌ Audit log archive missing')
```

### 4.6 切流量策略

按 [MetaPlatform-MIGRATION-01.md §4](../batch/MetaPlatform-MIGRATION-01.md) 的 4-6 周计划：

| 周 | 范围 | 监控时长 | 回滚阈值 |
|---|---|---|---|
| Week 1 | dev 租户切 v6.0 | 24h | 错误率 > 5% 立即回滚 |
| Week 2 | staging 租户（10% 客户） | 48h | 错误率 > 2% 立即回滚 |
| Week 3 | canary 租户（1% 客户） | 72h | 错误率 > 1% 立即回滚 |
| Week 4-6 | 灰度 50% 客户 | 1 周 | 错误率 > 1% 立即回滚 |
| Week 7 | 100% 全量切 v6.0 | 持续监控 | — |

**切流量实现**：通过租户级 feature flag（mp-platform 提供 `tenant.migration.completed` 标志）：

```typescript
// 应用代码
import { tenantContext } from '@mp/runtime';

const isV6Migrated = await tenantContext.hasFlag('migration.v6.completed');
if (!isV6Migrated) {
  // 走 v3.0 兼容路径（仅过渡期存在）
  return legacyHandler(request);
}
// 走 v6.0 标准路径
```

### 4.7 回滚策略

**回滚窗口**：
- Week 1-3：每次切流量保留 **24h 回滚窗口**
- Week 4-6：每次切流量保留 **1 周回滚窗口**
- Week 7 全量切完：**v3.0 保留 6 个月观察期**，仅应急

**回滚步骤**：
1. 关闭 v6.0 写入（`tenant.migration.completed = false`）
2. 流量切回 v3.0
3. 24h 监控 + 故障定位
4. 修复后重新切

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **幂等性** | 重复执行结果一致（ON CONFLICT DO UPDATE）|
| **批次大小** | 默认 500 行 / 批（Supabase 限制）|
| **可观测** | 导入进度 + 成功率 + 失败明细日志 + OTel trace |
| **可回滚** | 每批保留回滚窗口；feature flag 即时切换 |
| **可恢复** | 任何批次失败可从 checkpoint 重试 |
| **切流量分批** | 必须按租户粒度，**禁止一次性全量** |

## 6. 接口契约

### 6.1 Id 映射表（id_mapping/）

```
id_mapping/
├── tenants.csv       # v3_tenant_id, v6_tenant_id
├── users.csv         # v3_user_id, v6_user_id
├── customers.csv     # v3_customer_id, v6_customer_id
└── ...
```

格式：`v3_id,v6_id`（CSV）

### 6.2 Feature Flag API

```
GET  https://flags.mp-platform.local/api/v1/tenant/<tenant_id>/flags
POST https://flags.mp-platform.local/api/v1/tenant/<tenant_id>/flags
     body: {"migration.v6.completed": true}
```

由 `mp-platform` Edge Function 提供。

### 6.3 校验脚本（详见 [etl-validation](etl-validation.md)）

```bash
psql "$V6_DB_URL" -f scripts/etl/verify_etl.sql
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 4 个导入脚本写完 | 文件存在 |
| AC2 | dev / staging 演练成功，行数 100% 匹配 | verify_etl.sql |
| AC3 | 用户密码迁移验证（至少 1 个用户能登录）| e2e 测试 |
| AC4 | 17 域业务数据 100% 导入 + RLS 生效 | 端到端 |
| AC5 | 审计日志校验（Glacier 存在 + 行数匹配）| S3 + DB 对比 |
| AC6 | 按租户分批切流量：100% 完成 | feature flag 状态 |
| AC7 | v3.0 标记 deprecated | DNS / LB 配置 |
| AC8 | 每次切流量 24h 监控无异常 | SRE 日志 |
| AC9 | evidence/MetaPlatform-MIGRATION-01-IMPORT.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| [etl-export-v3](etl-export-v3.md) 输出 | Week 1 | 必须先 |
| Supabase Auth + 业务 schema | MetaPlatform-FOUNDATION-01 | 必须先 |
| feature flag 服务 | mp-platform | 必须先 |
| Id 映射表持久化 | id_mapping/ 目录 | 必须先 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 用户密码 hash 不兼容 | 用户登录失败 | 强制重置 + 邮件通知 |
| BIGINT → UUID 映射遗漏 | 外键失败 | 演练 + 双重校验 |
| 切流量业务中断 | 客户感知 | feature flag 灰度 + 24h 监控 |
| Supabase 写入限速 | 导入慢 | 调小 batch size（500 → 100）|
| 业务表 RLS 策略错误 | 跨租户访问 | 导入后端到端测试覆盖 |

## 10. 不做（Out of Scope）

- ❌ **业务逻辑迁移**：v6.0 重新实现
- ❌ **v6.0 兼容 v3.0 schema 双写**：禁止
- ❌ **回填历史数据**：仅 ETL 范围内数据
- ❌ **跨租户 JOIN**：v6.0 禁止
- ❌ **审计日志导入热库**：仅归档冷存储

---

*PRD v1.0 — 配套 [etl-export-v3](etl-export-v3.md) / [etl-validation](etl-validation.md) / [foundation-supabase-schema](foundation-supabase-schema.md)*