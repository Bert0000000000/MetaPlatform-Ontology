# MetaPlatform-EDGE-FN-01 — M12 ActionType.apply (preview / confirmed 三模式) ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-EDGE-FN-01.md](../active/batch/MetaPlatform-EDGE-FN-01.md)
> **关联 ADR**:[ADR-0056-ontology-generation.md](../active/decisions/ADR-0056-ontology-generation.md) (M12 三模式)
> **Module**:M12 ActionType.apply + HITL 三模式 (核心引擎层)
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — ActionType.apply EF)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `action-apply` EF (POST): body={action_rid, target_id?, params?, mode} | ✅ |
| AC1.2 | mode='preview' → 返回 hitl_request_id (action_confirm pending) + preview payload | ✅ |
| AC1.3 | mode='confirmed' → 启动 workflow (mock) + workflow_signals 自动落库 (via trigger) | ✅ |
| AC1.4 | 权限校验: caller role ≥ action.permission (admin > owner > member > guest) | ✅ |
| AC1.5 | invalid action_rid → 404 not_found | ✅ |
| AC1.6 | invalid mode → 400 invalid_mode | ✅ |
| AC1.7 | anon → 401, member 用 admin action → 403 | ✅ |
| AC1.8 | `tg_hitl_requests_to_workflow_signal` trigger 改为 AFTER INSERT OR UPDATE (覆盖 INSERT 场景) | ✅ |
| AC1.9 | 7/7 E2E PASS | ✅ |

## E2E 结果

```
Running 7 tests using 1 worker
[1/7] 1. preview 模式 → 返回 hitl_request_id (action_confirm pending)                                (pass)
[2/7] 2. confirmed 模式 → 启动 workflow (mock) + workflow_signals 自动落库                       (pass)
[3/7] 3. permission denied: member 用 admin-only action (customer.create) → 403                        (pass)
[4/7] 4. invalid action_rid → 404                                                                   (pass)
[5/7] 5. invalid mode → 400 invalid_mode                                                            (pass)
[6/7] 7. anon POST → 401                                                                            (pass)
[7/7] 7. member 用 owner action (order.approve) → 403                                                (pass)

  7 passed (3.2s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/action-apply/index.ts` | 180 | POST preview/confirmed 三模式 (查 ontology_action_types + 权限 + HITL + workflow_signals) |
| `e2e/action-apply.spec.ts` | 220 | 7 个 E2E |
| `supabase/migrations/20260820630000_create_workflow_signals.sql` | +1 行 | trigger 改为 AFTER INSERT OR UPDATE (覆盖 INSERT 场景) |

## 三模式 (per ADR-0053 §6.4)

| mode | 行为 | 用例 |
|---|---|---|
| `preview` | INSERT hitl_requests (action_confirm pending) + 返回 preview payload | 用户在 dsh Web 弹窗确认 |
| `confirmed` | INSERT hitl_requests (action_confirm approved) + 触发 workflow_signals trigger + mock Temporal 启动 | 用户已确认 → 后端启动 workflow |
| `apply` (future) | 直接 apply, 跳过 preview | 内部 admin-only 紧急执行 |

## 设计亮点

- **ontology_action_types 复用**: 直接读 Loop 1/3 表, 拿 rid → target_type → workflow_name → permission → hitl_type. 单一数据源.
- **trigger 覆盖 INSERT**: 改为 AFTER INSERT OR UPDATE, 让 EF 直接 INSERT approved hitl 时也能触发 workflow_signals trigger.
- **PoC mock Temporal**: 返回 workflow_id 占位 (生产由 mp-workflow worker 调 Temporal client.start()).
- **权限内嵌**: 不依赖外部 RBAC, 直接读 action.permission 与 caller role 对比. 简单且零额外依赖.

## 下一步 (Loop 2/3 + 3/3)

- Loop 2/3: mp-workflow Temporal worker 订阅 workflow_signals Realtime → 调 Temporal workflow.signal() / start()
- Loop 3/3: dsh Web 前端接收 Realtime hitl_requests INSERT → 弹窗显示 preview + 确认 → 调 action-apply mode='confirmed'

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M11 Ontology Kernel | ontology_action_types (Loop 1/3) — rid / workflow_name / permission / hitl_type |
| M13 HITL Hub | action_confirm HITL (Loop 1/3 hitl_requests) |
| M40 Workflow 引擎 | workflow_name 启动 Temporal workflow (Loop 3/3) |
| M17 Temporal worker | 消费 workflow_signals (Loop 2/3, 已有 schema) |

---

*MetaPlatform-EDGE-FN-01 Loop 1/3 (M12 ActionType.apply) — 2026-08-21 — 7/7 E2E PASS, 0 bug*