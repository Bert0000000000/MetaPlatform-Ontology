# MetaPlatform-ONTOLOGY-GEN-01 — M11 Ontology Kernel (Loop 1/3) ACCEPTED

> **状态**：✅ Loop 1/3 Accepted
> **日期**：2026-08-21
> **关联 Batch**：[MetaPlatform-ONTOLOGY-GEN-01.md](../active/batch/MetaPlatform-ONTOLOGY-GEN-01.md)
> **关联 ADR**：[ADR-0056-ontology-generation.md](../active/decisions/ADR-0056-ontology-generation.md)
> **关联 PRD**：[mp-ontology.md](../active/prd/mp-ontology.md)
> **Module**：M11 12 Ontology Kernel (核心引擎层 P0)
> **Commit**：e1eabcd

---

## 验收标准 (Loop 1/3 — 3 表 + view + RLS + audit + seed)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `public.ontology_object_types` 表 (rid, slug, properties, link_types, action_types, status, version) | ✅ |
| AC1.2 | `public.ontology_relation_types` 表 (rid, from_type, to_type, cardinality) | ✅ |
| AC1.3 | `public.ontology_action_types` 表 (rid, target_type, parameters, permission, workflow_name, hitl_type) | ✅ |
| AC1.4 | 4 RLS policies × 3 表 + tg_inject_tenant + tg_audit 触发器 | ✅ |
| AC1.5 | ON DELETE CASCADE 关联 tenants (测试 cleanup + 生产 tenant 注销) | ✅ |
| AC1.6 | `public.ontology_summary` view (per-tenant 计数) | ✅ |
| AC1.7 | `tg_tenants_seed_ontology` 触发器: 新租户创建时自动 seed 4 ObjectType + 2 Relation + 2 Action | ✅ |
| AC1.8 | audit_log FK 改为软关联 (避免 cascade delete + AFTER trigger 顺序竞争) | ✅ |
| AC1.9 | 内置基础本体: customer / order / product / contract + customer_has_orders / order_contains_products + customer.create / order.approve | ✅ |
| AC1.10 | 7/7 E2E PASS (view / ObjectType / Relation / Action / INSERT / anon RLS / tg_inject_tenant) | ✅ |

## E2E 结果

```
Running 7 tests using 1 worker
[1/7] 1. ontology_summary view → 4 ObjectType + 2 Relation + 2 Action (seed)  (pass)
[2/7] 2. ontology_object_types RLS list → 4 内置 ObjectType (admin)          (pass)
[3/7] 3. ontology_relation_types RLS list → 2 内置 Relation                 (pass)
[4/7] 4. ontology_action_types RLS list → 2 内置 Action                     (pass)
[5/7] 5. INSERT ontology_object_types 新 rid → 成功 + tg_audit 落 audit_log (pass)
[6/7] 6. anon GET → 200 + 0 rows (RLS blocks anon)                           (pass)
[7/7] 7. tg_inject_tenant 自动从 JWT 填 tenant_id                            (pass)

  7 passed (2.1s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820620000_create_ontology_kernel.sql` | 290 | 3 表 + 4 RLS × 3 + 3 triggers × 3 + view + seed + publication |
| `supabase/migrations/20260820621000_seed_ontology_on_tenant_create.sql` | 105 | seed 函数 + 触发器 (audit.disable 跳过 seed 写入) |
| `supabase/migrations/20260820622000_audit_log_fk_cascade.sql` | 50 | DROP audit_log FK (软关联) |
| `e2e/ontology-kernel.spec.ts` | 180 | 7 个 E2E |
| `scripts/dev/apply-ontology.js` | 15 | debug helper |

## 4 + 2 + 2 内置本体 (seed)

| 类型 | rid | name | status |
|---|---|---|---|
| ObjectType | customer / order / product / contract | 客户 / 订单 / 产品 / 合同 | active |
| Relation | customer_has_orders (one_to_many) | 客户拥有订单 | active |
| Relation | order_contains_products (many_to_many) | 订单包含产品 | active |
| Action | customer.create (workflow_saas, admin) | 创建客户 | active |
| Action | order.approve (workflow_saas, owner) | 审批订单 | active |

## 已解决的 FK 竞争问题

`ontology_*` ON DELETE CASCADE 触发 `tg_audit` AFTER DELETE → 重新 INSERT audit_log → 此时被级联删除的 tenants 行在同一事务内"消失" → IMMEDIATE FK 失败, DEFERRABLE 也失败 (ON DELETE CASCADE 顺序与 trigger 时机竞争).

解决: 删除 `audit_log.tenant_id` FK 约束, 改为软关联 (查询时 LEFT JOIN). audit_log 仍保留 tenant_id 值, 2 年合规保留.

## 下一步 (Loop 2/3 + 3/3)

- Loop 2/3: 12 Ontology Kernel 完整 CRUD Edge Functions (list / get / create / update / delete ObjectType + Relation + Action)
- Loop 3/3: M18 Ontology 本体生成 + 预览 (LLM 推断本体 + action_confirm HITL)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M12 ActionType.apply | ontology_action_types.workflow_name 调 Temporal |
| M13 HITL Hub | ontology_action_types.hitl_type 映射 4 种 HITL |
| M40 Workflow 引擎 | ontology_object_types.action_types 触发 ActionType.apply |
| M18 Ontology 生成 | ontology_* 是 LLM 输出目标 |

---

*MetaPlatform-ONTOLOGY-GEN-01 Loop 1/3 — 2026-08-21 — 7/7 E2E PASS, 0 bug*