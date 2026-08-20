# MetaPlatform-FOUNDATION-01 — RLS Exemptions Registry

> **状态**：Draft v1.0
> **维护者**：架构组 + SRE Lead
> **更新**：每次新增豁免必须双重签字 + 更新本文件

---

## 豁免规则（来自 foundation-rls-policy.md §6.2）

豁免 RLS 的表必须满足：

1. 表名以 `_internal_` / `_tmp_` / `_cache_` 开头
2. 表 COMMENT 标注 `[RLS-EXEMPT] 理由`
3. 本文件登记 + 双重签字（架构师 + SRE Lead）
4. `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` 必须紧跟 `CREATE TABLE`
5. CI gate `scripts/ci/rls-check.sh` 对这类表豁免检测

---

## 当前豁免清单

### 1. `temporal` schema（Temporal Cluster 持久化）

| 项 | 值 |
|---|---|
| Schema | `temporal` |
| 理由 | Temporal 系统账户需要全权访问 workflow history + visibility 表. 不可能有 tenant 维度（workflow 是跨租户编排的）|
| 登记日期 | 2026-08-20 |
| 架构师签字 | _pending_ |
| SRE Lead 签字 | _pending_ |
| 关联迁移 | `supabase/migrations/20260820120700_create_temporal_schema.sql` |
| 关联 PRD | [temporal-cluster.md](../docs/active/prd/temporal-cluster.md) §4.2.3 |

**所有 `temporal.*` 表**：DISABLE ROW LEVEL SECURITY，由 `temporal_user` 角色全权访问。

---

### 2. `_internal_*` 系统表（如有）

暂无。后续如需添加（如 `_internal_session_cache`），按以下流程：

```sql
CREATE TABLE public._internal_session_cache (...);
COMMENT ON TABLE public._internal_session_cache IS '[RLS-EXEMPT] 系统内部 session 缓存, 不含租户数据';
ALTER TABLE public._internal_session_cache DISABLE ROW LEVEL SECURITY;
```

然后在本文件 §2 追加一行 + 双重签字。

---

## 双重签字流程

每次新增豁免：

1. **作者** 在本文件追加新章节
2. **架构师评审** → 在签字栏写名字 + 日期
3. **SRE Lead 评审** → 在签字栏写名字 + 日期
4. **PR 合并** → CI gate `scripts/ci/rls-check.sh` 豁免 `_internal_*`/`_tmp_*`/`_cache_*` 前缀的表

---

*RLS 豁免是高敏操作. 任何豁免必须有业务正当理由, 不允许为了"省事"豁免.*