# MetaPlatform-ONTOLOGY-GEN-01 — M11 Ontology Kernel (Loop 2/3) ACCEPTED

> **状态**：✅ Loop 2/3 Accepted
> **日期**：2026-08-21
> **关联 Batch**：[MetaPlatform-ONTOLOGY-GEN-01.md](../active/batch/MetaPlatform-ONTOLOGY-GEN-01.md)
> **关联 ADR**：[ADR-0056-ontology-generation.md](../active/decisions/ADR-0056-ontology-generation.md)
> **Module**：M11 12 Ontology Kernel (核心引擎层 P0)
> **Commit**: (本 session)

---

## 验收标准 (Loop 2/3 — CRUD Edge Functions)

| # | 标准 | 状态 |
|---|---|---|
| AC2.1 | `list-ontology-types` EF (GET, ?type=object\|relation\|action&status=&rid=&limit=) | ✅ |
| AC2.2 | `get-ontology-type` EF (GET ?type=&id= 或 ?rid=) | ✅ |
| AC2.3 | `create-ontology-type` EF (POST, type + payload, 严格验证) | ✅ |
| AC2.4 | 创建需 admin/owner role (member → 403) | ✅ |
| AC2.5 | 3 表 cardinality / permission / hitl_type 验证 + many_to_one 新增 | ✅ |
| AC2.6 | tg_audit 触发器自动落 audit_log (验证 new_values->>'rid') | ✅ |
| AC2.7 | anon → 401, invalid type → 400 | ✅ |
| AC2.8 | 11/11 E2E PASS | ✅ |

## E2E 结果

```
Running 11 tests using 1 worker
[1/11] 1. list-ontology-types default → 4 seed ObjectTypes                    (pass)
[2/11] 2. list-ontology-types?type=relation → 2 seed relations                  (pass)
[3/11] 3. list-ontology-types?type=action → 2 seed actions                       (pass)
[4/11] 4. get-ontology-type?type=object&rid=customer → 200                       (pass)
[5/11] 5. get-ontology-type not found → 404                                      (pass)
[6/11] 6. create-ontology-type 新 ObjectType → 201 + audit_log                    (pass)
[7/11] 7. create-ontology-type 新 Relation (many_to_one) → 201                  (pass)
[8/11] 8. create-ontology-type 新 Action (含 workflow + hitl) → 201             (pass)
[9/11] 9. create-ontology-type member role → 403                                 (pass)
[10/11] 10. anon POST → 401                                                      (pass)
[11/11] 11. invalid type → 400                                                   (pass)

  11 passed (2.4s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/list-ontology-types/index.ts` | 90 | GET 统一查询 3 类型 (type + status + rid 过滤) |
| `supabase/functions/get-ontology-type/index.ts` | 80 | GET 单条 (?id 或 ?rid) |
| `supabase/functions/create-ontology-type/index.ts` | 135 | POST 创建 (admin/owner 校验 + 3 类型验证) |
| `e2e/ontology-crud.spec.ts` | 250 | 11 个 E2E |

## 设计亮点

- **统一查询**: list/get 接受 `type=object|relation|action` 参数, 内部映射到对应 schema.table. 减少 EF 数量 (3 → 1).
- **admin/owner 校验**: 本体是核心配置面, member 角色只读 (未来 Loop 3/3 通过 `preview` + HITL 升级).
- **service_role bypass RLS**: tg_inject_tenant 在 service_role 下读不到 JWT claims (NULL), EF 显式带 tenant_id 避免 trigger 异常.
- **校验 3 类型**: rid / slug / from_type / to_type / target_type / cardinality / permission / hitl_type 严格 enum 校验.

## 下一步 (Loop 3/3)

- M18 Ontology 本体生成 + 预览 (LLM 推断本体 → action_confirm HITL → 落 ontology_* 表)
- 复用 Loop 2/3 的 create-ontology-type 作为 HITL 通过后的落库入口

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M12 ActionType.apply | create-ontology-type 创建的 ActionType 立即可用 workflow_name + hitl_type |
| M18 Ontology 生成 | LLM 输出 → create-ontology-type 落库 |
| M13 HITL Hub | ontology_action_types.hitl_type 决定走哪种 HITL |
| mp-platform UI | list/get-ontology-type 作为管理后台 API |

---

*MetaPlatform-ONTOLOGY-GEN-01 Loop 2/3 — 2026-08-21 — 11/11 E2E PASS, 0 bug*