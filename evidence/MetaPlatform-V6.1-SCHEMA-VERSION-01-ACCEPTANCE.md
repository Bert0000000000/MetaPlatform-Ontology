# MetaPlatform.1-SCHEMA-VERSION-01 - ACCEPTANCE

> **状态**：✅ Accepted (Schema Versioning 完整骨架)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform.1-SCHEMA-VERSION-01.md](../batch/MetaPlatform.1-SCHEMA-VERSION-01.md)
> **关联 PRD**：[ontology-gen.md](../prd/ontology-gen.md) §4.4 + ADR-0064

---

## 验收标准（AC）

- [x] `ontology_object_types` 加 `active_version` 字段（默认 v1）
- [x] `ontology_object_type_versions` 表（多版本并存）
  - 唯一约束 (tenant_id, object_type_id, version)
  - `deprecated_at` 软删除
  - RLS + tg_inject_tenant + tg_audit
- [x] `schema_migrations` 审计表
  - from_version → to_version
  - status (pending / running / completed / failed / rolled_back)
  - pg_cron 每小时 timeout failed 标记
- [x] RPC `activate_object_type_version(p_tenant_id, p_object_type_id, p_new_version)`
  - SECURITY DEFINER + service_role / authenticated / anon grant
- [x] `schema-version-switch` Edge Function
  - 写 migration 审计
  - 调 RPC
  - 失败时标记 failed + error message
- [x] evidence 完成

## 待用户在宿主机完成

- [ ] 测试 schema 升级:
```sql
-- 1. 创建 v2 版本
INSERT INTO ontology_object_type_versions (tenant_id, object_type_id, version, properties, changelog)
VALUES (auth.tenant_id, '<uuid>', 'v2', '{"new_field": "text"}', 'add new_field');

-- 2. 切到 v2
SELECT activate_object_type_version(
  (SELECT tenant_id FROM ontology_object_types WHERE id = '<uuid>'),
  '<uuid>',
  'v2'
);

-- 3. 验证
SELECT active_version FROM ontology_object_types WHERE id = '<uuid>';
-- 应该返回 'v2'
```

- [ ] Playwright E2E (schema-version.spec.ts):
  - 创建 v2 → 切到 v2 → 验证 active_version
  - 切到不存在版本 → 400/500

## 已交付文件

| 文件 | 说明 |
|---|---|
| `supabase/migrations/20260820210000_create_schema_versioning.sql` | 多版本 ontology + 迁移审计 + RPC + cron |
| `supabase/functions/schema-version-switch/index.ts` | 切换版本 Edge Function (写审计 + 调 RPC) |
| `docs/active/batch/MetaPlatform.1-SCHEMA-VERSION-01.md` | Batch 任务清单 |
| `evidence/MetaPlatform.1-SCHEMA-VERSION-01-ACCEPTANCE.md` | Acceptance 文档 |

## Schema 升级流程

```
[Schema v1] --(v2 提议)--> [HITL Hub action_confirm]
                         --(批准)--> [Edge Function schema-version-switch]
                                     ↓ 1. 写 schema_migrations 审计 (status=running)
                                     ↓ 2. 调 RPC activate_object_type_version
                                     ↓ 3. 成功 → 改 status=completed
                                     ↓ 4. 失败 → 改 status=failed + error
                                     ↓
[Schema v2] (active_version 更新)
```

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 切换版本影响旧数据 | v1 + v2 并存, 业务表加 `_version` 列, 旧数据读 v1, 新数据写 v2 |
| 迁移超时 | pg_cron 每小时检查, 超 1h 自动 mark failed |
| 误切换 | admin/owner role 限制 + migration 审计 + HITL 确认 |

---

*MetaPlatform.1-SCHEMA-VERSION-01 ACCEPTANCE — 2026-08-20 — v6.1 多版本 schema 完整骨架*