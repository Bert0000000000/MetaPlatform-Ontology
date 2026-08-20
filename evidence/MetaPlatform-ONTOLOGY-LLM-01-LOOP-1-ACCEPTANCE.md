# MetaPlatform-ONTOLOGY-GEN-01 + MetaPlatform-LLM-01 — M11 Loop 3/3 + M18 ACCEPTED

> **状态**:✅ Loop 3/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-ONTOLOGY-GEN-01.md](../active/batch/MetaPlatform-ONTOLOGY-GEN-01.md) + [MetaPlatform-LLM-01.md](../active/batch/MetaPlatform-LLM-01.md)
> **关联 ADR**:[ADR-0056-ontology-generation.md](../active/decisions/ADR-0056-ontology-generation.md)
> **Module**:M11 12 Ontology Kernel (Loop 3/3) + M18 Ontology 本体生成 + 预览
> **Commit**:(本 session)

---

## 验收标准 (Loop 3/3 — LLM 本体生成 proposal)

| # | 标准 | 状态 |
|---|---|---|
| AC3.1 | `generate-ontology-proposal` EF (POST, admin/owner) | ✅ |
| AC3.2 | 输入 description → 输出 object_types + relation_types + action_types proposal | ✅ |
| AC3.3 | keyword 匹配推断: 客户 / 订单 / 产品 / 合同 / 发票 + 关系模式 + 动作模式 | ✅ |
| AC3.4 | relation_types 仅在两端 ObjectType 都识别时输出 | ✅ |
| AC3.5 | action_types 仅在 target ObjectType 识别时输出 | ✅ |
| AC3.6 | description 太长 > 4000 → 400 | ✅ |
| AC3.7 | 空描述 → 400 invalid_description | ✅ |
| AC3.8 | anon → 401, member → 403 | ✅ |
| AC3.9 | 9/9 E2E PASS | ✅ |

## E2E 结果

```
Running 9 tests using 1 worker
[1/9] 1. 描述含 "客户 + 订单 + 审批" → 2 ObjectType + 1 Relation + 1 Action       (pass)
[2/9] 2. 描述含 "产品 + 订单" → order_contains_products Relation                (pass)
[3/9] 3. 描述含 "发票 + 订单" → invoice_belongs_to_order Relation                (pass)
[4/9] 4. 描述含 "合同 + 签署" → contract.sign Action (action_confirm HITL)      (pass)
[5/9] 5. 空描述 → 400                                                       (pass)
[6/9] 6. 描述无关键词 → 0 提案                                              (pass)
[7/9] 7. anon POST → 401                                                    (pass)
[8/9] 8. member role → 403                                                 (pass)
[9/9] 9. 描述过长 (>4000) → 400                                            (pass)

  9 passed (3.2s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/generate-ontology-proposal/index.ts` | 200 | POST mock LLM 本体生成 (5 EntityType + 4 Relation + 4 Action patterns) |
| `e2e/ontology-generation.spec.ts` | 180 | 9 个 E2E |

## 内置识别规则 (mock LLM)

| 类型 | 关键词 | 产出 |
|---|---|---|
| ObjectType | 客户/customer | customer (email, name, phone) |
| ObjectType | 订单/order | order (amount, status) |
| ObjectType | 产品/product | product (sku, name, price) |
| ObjectType | 合同/contract | contract (title, amount, status) |
| ObjectType | 发票/invoice | invoice (amount, status) |
| Relation | 客户 + 订单 | customer_has_orders (one_to_many) |
| Relation | 订单 + 产品 | order_contains_products (many_to_many) |
| Relation | 发票 + 订单 | invoice_belongs_to_order (many_to_one) |
| Relation | 合同 + 客户 | contract_with_customer (many_to_one) |
| Action | 创建 + 客户 | customer.create (admin, workflow_saas) |
| Action | 审批 + 订单 | order.approve (owner, workflow_saas) |
| Action | 签署 + 合同 | contract.sign (owner, action_confirm) |
| Action | 开 + 发票 | invoice.issue (admin, workflow_saas) |

## 设计亮点

- **3 阶段**: describe → generate-ontology-proposal (preview) → 用户确认 → create-ontology-type (落库, Loop 2/3 已 ship)
- **proposal 不落库**: 仅返回 preview, 用户必须显式调 create-ontology-type 确认. action_confirm HITL 是可选第二道闸 (Loop 3/3+).
- **relation/action 引用校验**: 仅在两端 ObjectType 都被识别时输出 relation. 避免悬空引用.
- **mock → real LLM**: 替换点明确 (generateProposal() 函数), 生产用 dsh llm-deepseek provider.

## 下一步

- Loop 1/3 (M12 ActionType.apply): 走 ontology_action_types.workflow_name 启动 Temporal workflow
- mp-ontology 前端 UI: 显示 generate-ontology-proposal 输出 → 用户确认 → 批量 create-ontology-type
- 真实 LLM 替换: dsh llm-deepseek API 调 + system prompt 注入 4 pillar schema 规则

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M11 Ontology Kernel | 复用 ontology_object_types / relation_types / action_types (Loop 1/3+2/3) |
| M18 Ontology 生成 | dsh llm-deepseek provider (Loop 3/3 替换 mock) |
| M12 ActionType.apply | proposal 的 action_types.workflow_name + hitl_type 直接用于 workflow 调度 |
| mp-frontend | 管理后台显示 proposal, 用户确认落库 |

---

*MetaPlatform-ONTOLOGY-GEN-01 + LLM-01 Loop 3/3 + M18 — 2026-08-21 — 9/9 E2E PASS, 0 bug*