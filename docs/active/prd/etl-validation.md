# PRD：etl-validation

> **模块**：v3.0 → v6.0 数据迁移 — 校验阶段
> **对应 Batch**：[MetaPlatform-MIGRATION-01](../batch/MetaPlatform-MIGRATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + DBA
> **日期**：2026-08-20

---

## 1. 概述（What）

在 [etl-export-v3](etl-export-v3.md) 与 [etl-import-v6](etl-import-v6.md) 之后，**端到端校验 4 类数据一致性**：

- v3.0 源库行数 = 中间文件行数 = v6.0 导入行数（**100% 匹配**）
- 字段值抽样对比（至少 1%）
- 跨租户访问被拒（RLS 生效）
- 用户能登录（密码迁移成功）
- 切流量无业务中断

校验不通过 → **禁止切流量**。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- ETL 涉及 4 类数据、17 域、千万行级，任何环节漏数据 / 错数据都是 P0
- v3.0 → v6.0 schema 完全不同，必须**多重校验**（行数 + 字段值 + 端到端）
- 校验脚本与导出 / 导入脚本解耦，独立 review

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 校验脚本**覆盖所有 19 个数据表**（4 类 + 17 域 - 用户表重合 = 17 域 - 1 + 4 = 20） |
| G2 | 行数校验 100% 自动化（脚本输出 0 不匹配） |
| G3 | 字段值抽样校验 1% |
| G4 | 端到端业务校验：登录 / 写数据 / RLS |
| G5 | 校验报告入 evidence，可追溯 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **DBA** | 跑校验脚本；写校验报告 |
| **SRE** | 监控校验进度；切流量前最后把关 |
| **架构组** | 评审校验报告；批准切流量 |

## 4. 功能需求（Functional Requirements）

### 4.1 三层校验

#### 4.1.1 L1：行数校验（自动化）

```sql
-- scripts/etl/verify_etl.sql
-- 对比 v3.0 行数 vs 中间文件行数 vs v6.0 行数
WITH comparison AS (
    SELECT
        'tenants' AS dataset,
        (SELECT COUNT(*) FROM v3.tenants)            AS v3_count,
        (SELECT COUNT(*) FROM tmp_tenants_csv)        AS file_count,
        (SELECT COUNT(*) FROM public.tenants
         WHERE metadata->>'v3_tenant_id' IS NOT NULL) AS v6_count
    UNION ALL
    SELECT
        'users',
        (SELECT COUNT(*) FROM v3.users WHERE deleted_at IS NULL),
        (SELECT COUNT(*) FROM tmp_users_csv),
        (SELECT COUNT(*) FROM auth.users WHERE raw_user_meta_data->>'v3_user_id' IS NOT NULL)
    UNION ALL
    SELECT 'orders',
        (SELECT COUNT(*) FROM v3.orders),
        (SELECT COUNT(*) FROM tmp_orders_jsonl),
        (SELECT COUNT(*) FROM public.orders WHERE created_at < '2026-XX-XX')
    -- ... 17 域
)
SELECT
    dataset,
    v3_count, file_count, v6_count,
    CASE
        WHEN v3_count = file_count AND file_count = v6_count THEN '✅ MATCH'
        WHEN v3_count = v6_count AND file_count != v6_count THEN '⚠️ FILE MISMATCH'
        ELSE '❌ ETL FAILED'
    END AS status
FROM comparison;
```

#### 4.1.2 L2：字段值抽样（1%）

```python
# scripts/etl/verify_sample.py
"""
从 v3.0 随机抽 1% 行，对比中间文件 vs v6.0 字段值
"""
import csv
import json
import random
import psycopg2
from supabase import create_client

V3 = psycopg2.connect(...)
v6 = create_client(URL, KEY)

# 抽样函数：随机抽 1%
def sample_ids(table, ratio=0.01):
    with V3.cursor() as cur:
        cur.execute(f'SELECT id FROM {table} ORDER BY RANDOM() LIMIT (SELECT COUNT(*) * {ratio} FROM {table})::int')
        return [r[0] for r in cur.fetchall()]

# 字段值对比
def compare_field(table, v3_id, field_name):
    with V3.cursor() as cur:
        cur.execute(f'SELECT {field_name} FROM {table} WHERE id = %s', (v3_id,))
        v3_value = cur.fetchone()[0]

    v6_row = v6.from_(table).select(field_name).eq('metadata->>v3_id', v3_id).single().execute()
    v6_value = v6_row.data[field_name] if v6_row.data else None

    if str(v3_value) != str(v6_value):
        return f'❌ {table}.{field_name}: v3={v3_value} v6={v6_value}'
    return None

# 跑 17 域 × 5 个关键字段
TABLES_FIELDS = {
    'orders':    ['amount', 'status', 'customer_id', 'created_at', 'tenant_id'],
    'customers': ['name', 'email', 'phone', 'created_at', 'tenant_id'],
    # ...
}

mismatches = []
for table, fields in TABLES_FIELDS.items():
    sampled_ids = sample_ids(f'v3_{table}')
    for v3_id in sampled_ids:
        for field in fields:
            err = compare_field(table, v3_id, field)
            if err:
                mismatches.append(err)

if mismatches:
    print(f'❌ {len(mismatches)} mismatches:')
    for m in mismatches[:20]:
        print(f'  {m}')
    sys.exit(1)
else:
    print('✅ Field value sampling passed')
```

#### 4.1.3 L3：端到端业务校验

```typescript
// tests/e2e/etl-validation.spec.ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabase = create_client(URL, ANON_KEY);

test('L3.1 用户登录（密码迁移验证）', async () => {
    // 用 v3.0 导入的账号登录
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'imported-user-1@example.com',
        password: 'original-v3-password',  // 应该 hash 兼容
    });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
});

test('L3.2 跨租户访问被拒（RLS 生效）', async () => {
    // 登录 tenant A 用户
    await supabase.auth.signInWithPassword({
        email: 'tenant-a-user@example.com',
        password: 'original-v3-password',
    });

    // 尝试查询 tenant B 的数据（应该被 RLS 拒）
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', 'tenant-b-uuid');  // 故意查别的租户
    expect(data).toEqual([]);  // RLS 过滤为空
    expect(error).toBeNull();
});

test('L3.3 写数据 + audit_log 触发', async () => {
    await supabase.auth.signInWithPassword({...});

    // 写一条订单
    const { data: order } = await supabase.from('orders').insert({
        tenant_id: 'my-tenant-uuid',
        customer_id: 'my-customer-uuid',
        amount: 100.00,
        status: 'pending',
    }).select().single();

    // 验证 audit_log 有记录
    const { data: audit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('row_pk->>id', order.id)
        .single();
    expect(audit).toBeTruthy();
    expect(audit.action).toBe('INSERT');
});

test('L3.4 切流量 feature flag 工作', async () => {
    // 测试 v3.0 兼容路径
    process.env.TENANT_MIGRATION_V6 = 'false';
    const v3Handler = await import('../src/legacy-handler');
    const result = await v3Handler.handle(request);
    expect(result.source).toBe('v3-legacy');

    // 切换到 v6.0 路径
    process.env.TENANT_MIGRATION_V6 = 'true';
    const v6Handler = await import('../src/v6-handler');
    const result2 = await v6Handler.handle(request);
    expect(result2.source).toBe('v6');
});
```

### 4.2 校验报告模板

```markdown
# evidence/MetaPlatform-MIGRATION-01-VALIDATION-<env>-<date>.md

## 环境
- v3.0 库：v3-prod-readonly.mp-platform.local
- v6.0 库：v6-prod.mp-platform.local
- 执行时间：2026-XX-XX HH:MM UTC

## L1：行数校验

| dataset | v3_count | file_count | v6_count | status |
|---|---|---|---|---|
| tenants | 10234 | 10234 | 10234 | ✅ |
| users   | 100234 | 100234 | 100234 | ✅ |
| orders  | 5234521 | 5234521 | 5234521 | ✅ |
| ... (17 行) | | | | |

**L1 通过率**：17/17 = 100%

## L2：字段值抽样（1%）

- 总抽样数：172 行（17 域 × 10 行）
- 不匹配数：0
- **L2 通过率**：100%

## L3：端到端业务校验

| 测试 | 结果 |
|---|---|
| 用户登录（密码迁移）| ✅ |
| 跨租户 RLS 拒绝 | ✅ |
| 写数据 + audit_log 触发 | ✅ |
| 切流量 feature flag | ✅ |

**L3 通过率**：4/4 = 100%

## 结论

✅ **所有校验通过，可继续切流量**（或 ❌ 校验失败，禁止切流量）

## 签名

- DBA：________
- SRE：________
- 架构组：________
```

### 4.3 切流量门控

```python
# scripts/etl/can_proceed.py
"""
切流量前必须通过所有校验，否则拒绝
"""
import subprocess

def check_l1():
    result = subprocess.run(['psql', '$V6_DB_URL', '-f', 'verify_etl.sql'],
                          capture_output=True, text=True)
    return '❌' not in result.stdout

def check_l2():
    result = subprocess.run(['python3', 'verify_sample.py'],
                          capture_output=True, text=True)
    return result.returncode == 0

def check_l3():
    result = subprocess.run(['pnpm', 'test:e2e'],
                          capture_output=True, text=True)
    return result.returncode == 0

if __name__ == '__main__':
    l1 = check_l1()
    l2 = check_l2()
    l3 = check_l3()
    print(f'L1: {"✅" if l1 else "❌"}')
    print(f'L2: {"✅" if l2 else "❌"}')
    print(f'L3: {"✅" if l3 else "❌"}')
    if l1 and l2 and l3:
        print('✅ All checks passed. Safe to proceed with traffic migration.')
        sys.exit(0)
    else:
        print('❌ Checks failed. DO NOT proceed with traffic migration.')
        sys.exit(1)
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **完整性** | 覆盖 17 域 + 4 类数据 |
| **自动化** | L1 + L2 + L3 全部脚本化 |
| **可重现** | 校验脚本 idempotent |
| **可追溯** | 校验报告入仓（evidence/）|
| **门控** | 校验未通过禁止切流量 |
| **时效** | 每次切流量前 24h 内必须重跑 |

## 6. 接口契约

### 6.1 校验脚本

```bash
# 单次校验
psql "$V6_DB_URL" -f scripts/etl/verify_etl.sql
python3 scripts/etl/verify_sample.py
pnpm test:e2e --grep etl-validation

# 切流量门控
python3 scripts/etl/can_proceed.py
```

### 6.2 报告位置

```
evidence/MetaPlatform-MIGRATION-01-VALIDATION-<env>-<YYYYMMDD>.md
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | L1 行数校验脚本覆盖 17 域 + 4 类数据 | 脚本存在 + 输出完整 |
| AC2 | L2 字段值抽样脚本 1% 覆盖 | verify_sample.py |
| AC3 | L3 端到端业务校验 4 个场景通过 | Playwright 测试 |
| AC4 | 切流量门控脚本 `can_proceed.py` 工作 | 模拟失败 / 成功 |
| AC5 | dev / staging 各 1 份校验报告落地 | 文件存在 |
| AC6 | prod 每次切流量前 24h 内校验报告存在 | 报告列表 |
| AC7 | 校验未通过时切流量被阻断 | can_proceed.py 测试 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| [etl-export-v3](etl-export-v3.md) 输出 | Week 1 | 必须先 |
| [etl-import-v6](etl-import-v6.md) 完成 | Week 2 | 必须先 |
| 测试账号 / 测试租户 | DBA / SRE | 必须先 |
| Playwright / 测试框架 | 基础工具 | 必须 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 抽样脚本漏掉关键字段 | 数据错误未发现 | 5 关键字段 × 17 域 × 10 样本 = 850 个对比点 |
| 端到端测试不稳定 | 误报失败 | 多环境跑 + 失败重试 + 人工 review |
| 切流量门控被绕过 | 故障上线 | CI gate + SRE 二次审核 |
| RLS 校验不充分 | 跨租户泄露 | 多租户交叉测试 + fuzz 测试 |

## 10. 不做（Out of Scope）

- ❌ **性能压测**：v6.0 上线后单独做
- ❌ **业务逻辑验证**：业务 Owner 负责
- ❌ **跨环境数据对比**：仅同环境对比
- ❌ **自动化回滚**：人工决策

---

*PRD v1.0 — 配套 [etl-export-v3](etl-export-v3.md) / [etl-import-v6](etl-import-v6.md) / [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-rls-policy](foundation-rls-policy.md)*