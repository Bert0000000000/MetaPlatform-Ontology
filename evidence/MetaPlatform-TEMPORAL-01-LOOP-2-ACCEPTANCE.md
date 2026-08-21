# MetaPlatform-TEMPORAL-01 — M40 Temporal worker Loop 2/3 ACCEPTED

> **状态**:✅ Loop 2/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-TEMPORAL-01.md](../active/batch/MetaPlatform-TEMPORAL-01.md)
> **关联 ADR**:[ADR-0052-temporal.md](../active/decisions/ADR-0052-temporal.md)
> **Module**:M40 Workflow Path C (mp-workflow worker)
> **Commit**:(本 session)

---

## 验收标准 (Loop 2/3 — Temporal worker mock)

| # | 标准 | 状态 |
|---|---|---|
| AC2.1 | `temporal-worker-consume` EF (GET / POST, admin/owner) | ✅ |
| AC2.2 | 拉 pending signals (按 created_at 顺序, limit 控制) | ✅ |
| AC2.3 | 模拟 Temporal workflow start (PoC; 生产: Temporal client) | ✅ |
| AC2.4 | consume 成功 → status: pending → sent + sent_at | ✅ |
| AC2.5 | consume 失败 → status: pending → failed + error | ✅ |
| AC2.6 | hitl_decision signal must 有 valid decision (approved/rejected) | ✅ |
| AC2.7 | 多次 consume (重复) → 0 consumed (无 pending) | ✅ |
| AC2.8 | limit 参数 (limit=1 只 consume 1) | ✅ |
| AC2.9 | anon → 401, member → 403 | ✅ |
| AC2.10 | 9/9 E2E PASS | ✅ |

## E2E 结果

```
Running 9 tests using 1 worker
[1/9] 1. GET /temporal-worker-consume → 200 + consumed field                        (pass)
[2/9] 2. consume 前 pending > 0, 后 = 0                                            (pass)
[3/9] 3. consume 后 sent count 增加 + sent_at 非空                                  (pass)
[4/9] 4. workflow_signals result 包含 workflow_id + status=sent                        (pass)
[5/9] 5. 多次 consume (重复) → 0 consumed (no pending)                                (pass)
[6/9] 6. invalid decision payload → status=failed + error                              (pass)
[7/9] 7. anon → 401                                                                  (pass)
[8/9] 8. member role → 403                                                           (pass)
[9/9] 9. limit 参数工作 (limit=1 只 consume 1 个)                                     (pass)

  9 passed (4.2s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/temporal-worker-consumer/index.ts` | 130 | GET mock Temporal workflow signal 消费 + 更新 status |
| `e2e/temporal-worker.spec.ts` | 250 | 9 个 E2E |

## 架构 (PoC → 生产)

```
PoC (本 Loop 2/3):
  temporal-worker-consume EF (Deno) 消费 workflow_signals.pending
  └─ mock Temporal client.start() → 返回 fake run_id
  └─ update signal.status = 'sent' + sent_at
  └─ 失败时 status='failed' + error

生产 (Loop 3/3):
  + Temporal client (@temporalio/client.start)
  + Realtime 订阅 workflow_signals UPDATE (低延迟)
  + Worker 心跳 / 健康检查
  + 多 node 实例 (K8s Deployment) 并发消费 (SKIP LOCKED)
```

## 下一步 (Loop 3/3)

- 真实 Temporal client 集成 (K8s Service: mp-temporal:7233 / workflow: TemporalWorker)
- Realtime subscription (`workflow_signals` UPDATE → low latency)
- K8s Deployment (mpsv-runtime namespace) + HPA
- pg_cron `temporal-worker-cron` (本地 dev 兜底)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M13 HITL Hub | decide-hitl 触发 signal → worker 消费 |
| M12 ActionType | action-apply confirmed → signal (hitl_decision) → worker |
| M22 多级审批 | escalate-hitl → 新 signal → worker |
| M40 Workflow 引擎 | hitl_decision signal → 恢复 Temporal workflow |

---

*MetaPlatform-TEMPORAL-01 Loop 2/3 — 2026-08-21 — 9/9 E2E PASS, 0 bug*