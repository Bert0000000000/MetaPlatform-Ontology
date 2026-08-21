# MetaPlatform-MP-WORKFLOW-01 — M40 Workflow worker consume workflow_signals (Loop 1/3) ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-MP-WORKFLOW-01.md](../active/batch/MetaPlatform-MP-WORKFLOW-01.md)
> **关联 ADR**:[ADR-0052-temporal-workflow.md](../active/decisions/ADR-0052-temporal-workflow.md)
> **Module**:M40 Workflow 引擎 (业务能力层 P0)
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — worker consume + 状态机)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `temporal-worker-consume` EF (POST, admin/owner) 消费 workflow_signals | ✅ |
| AC1.2 | SELECT pending signals (ORDER BY created_at, LIMIT max_batch) | ✅ |
| AC1.3 | 调 Temporal signal (PoC: mock) + UPDATE status='sent' + sent_at | ✅ |
| AC1.4 | Unknown workflow → status='failed' + error 字段 | ✅ |
| AC1.5 | max_batch 限制 (默认 10, 上限 100) | ✅ |
| AC1.6 | 已被消费 (status=sent) → 不会再次 consume | ✅ |
| AC1.7 | 端到端: action-apply confirmed → trigger → worker consume → sent | ✅ |
| AC1.8 | anon → 401, member → 403 | ✅ |
| AC1.9 | 9/9 E2E PASS | ✅ |

## E2E 结果

```
Running 9 tests using 1 worker
[1/9] 1. consume pending signals → sent=2 + status=sent + sent_at 非空         (pass)
[2/9] 2. consume 空队列 → consumed=0                                          (pass)
[3/9] 3. max_batch=1 限制 → 只 consume 1 条 (留 1 pending)                    (pass)
[4/9] 4. unknown workflow type → status=failed + error                          (pass)
[5/9] 5. signal 已被消费 (status=sent) → 不会再次 consume                      (pass)
[6/9] 6. worker_id 自定义 → 返回 worker_id 字段                                (pass)
[7/9] 7. anon → 401                                                              (pass)
[8/9] 8. member role → 403                                                      (pass)
[9/9] 9. 端到端: action-apply confirmed → trigger → worker consume → sent       (pass)

  9 passed (6.6s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/temporal-worker-consume/index.ts` | 110 | POST 消费 workflow_signals (mock Temporal signal + 状态机更新) |
| `e2e/temporal-worker.spec.ts` | 270 | 9 个 E2E |

## 状态机 (per ADR-0052)

```
pending ───[worker consume]──> sent ───[workflow ack]──> acknowledged
   │
   └──[error]──> failed
```

## 闭环链路 (M11 + M12 + M13 + M40)

```
User → action-apply (confirmed mode, M12)
  ↓
hitl_requests INSERT (action_confirm, status=approved, workflow_id)
  ↓
trigger tg_hitl_to_workflow_signal (M13 Loop 2/3)
  ↓
workflow_signals INSERT (status=pending, payload={decision, ...})
  ↓
[temporal-worker-consume EF] (M40, this Loop)
  ↓
"调 Temporal signal" (PoC: mock) + UPDATE status='sent'
  ↓
[生产: mp-workflow-worker (K8s) 调 Temporal SDK Client.signal()]
  ↓
workflow 完成 → UPDATE status='acknowledged'
```

## 设计亮点

- **消费幂等**: 已被消费的 signal 不会再被 SELECT (status != 'pending' 过滤). 测试 5 验证.
- **PoC → 生产路径**: mock Temporal 调用替换为真实 Temporal SDK. 接口契约不变, worker 切换到 K8s Deployment 即可.
- **错误隔离**: unknown workflow 标记 failed + error, 不阻塞其他 signal 消费 (测试 4 验证).
- **batch 控制**: max_batch 防 worker 一次消费太多, 留空间给其他 worker (测试 3 验证).

## 下一步 (Loop 2/3 + 3/3)

- Loop 2/3: Realtime 订阅 (workflow_signals INSERT/UPDATE → EF 触发, 低延迟响应)
- Loop 3/3: K8s 部署 mp-workflow-worker (Temporal SDK 真实 signal + ack)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M13 HITL Hub | consume workflow_signals (Loop 2/3 创建) |
| M12 ActionType.apply | confirmed mode 触发 hitl approved → workflow_signals |
| M11 Ontology Kernel | workflow_name (e.g. OrderApproval) 校验 + action_confirm 类型 |
| M40 Workflow 引擎 | 闭环 (本 Loop) |

---

*MetaPlatform-MP-WORKFLOW-01 Loop 1/3 — 2026-08-21 — 9/9 E2E PASS, 0 bug*