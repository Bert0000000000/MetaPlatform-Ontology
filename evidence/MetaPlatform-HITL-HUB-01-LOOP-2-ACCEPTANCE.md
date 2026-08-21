# MetaPlatform-HITL-HUB-01 — M13 HITL Hub (Loop 2/3) ACCEPTED

> **状态**:✅ Loop 2/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-HITL-HUB-01.md](../active/batch/MetaPlatform-HITL-HUB-01.md)
> **关联 ADR**:[ADR-0053-hitl-hub.md](../active/decisions/ADR-0053-hitl-hub.md)
> **Module**:M13 HITL Hub (核心引擎层 P0)
> **Commit**:(本 session)

---

## 验收标准 (Loop 2/3 — Temporal signal 联动)

| # | 标准 | 状态 |
|---|---|---|
| AC2.1 | `public.workflow_signals` 表 (id, tenant_id, hitl_request_id, workflow_id, signal_name, payload, status, error, sent_at, acknowledged_at) | ✅ |
| AC2.2 | 4 RLS policies + tg_inject_tenant + tg_audit | ✅ |
| AC2.3 | supabase_realtime publication add (worker 实时订阅) | ✅ |
| AC2.4 | `tg_hitl_requests_to_workflow_signal` trigger: hitl UPDATE → INSERT workflow_signals (pending, ON CONFLICT 覆盖幂等) | ✅ |
| AC2.5 | `list-workflow-signals` EF (GET pending, admin/owner) | ✅ |
| AC2.6 | `ack-workflow-signal` EF (POST sent/acknowledged/failed, 409 already_acknowledged) | ✅ |
| AC2.7 | 11/11 E2E PASS | ✅ |

## E2E 结果

```
Running 11 tests using 1 worker
[1/11] 1. decide approved (with workflow_id) → workflow_signals pending                   (pass)
[2/11] 2. decide approved (no workflow_id) → 不创建 workflow_signals                        (pass)
[3/11] 3. decide rejected (with workflow_id) → INSERT workflow_signals payload.decision=rejected  (pass)
[4/11] 4. list-workflow-signals (admin) → 看见 pending                                      (pass)
[5/11] 5. ack-workflow-signal 'sent' → status=sent + sent_at                                 (pass)
[6/11] 6. ack-workflow-signal 'acknowledged' → status=acknowledged + acknowledged_at        (pass)
[7/11] 7. ack-workflow-signal 'failed' + error → status=failed + error 列                    (pass)
[8/11] 8. ack-workflow-signal already_acknowledged → 409                                     (pass)
[9/11] 9. anon GET list → 401                                                              (pass)
[10/11] 10. list-workflow-signals member role → 403                                          (pass)
[11/11] 11. TG 幂等: 同一个 hitl_id 重新决策 → ON CONFLICT 更新 payload                     (pass)

  11 passed (1.8s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820630000_create_workflow_signals.sql` | 110 | 表 + 4 RLS + 2 triggers + 1 tg + Realtime + view |
| `supabase/functions/list-workflow-signals/index.ts` | 70 | GET pending (admin/owner) |
| `supabase/functions/ack-workflow-signal/index.ts` | 90 | POST 标记 sent/acknowledged/failed + 409 |
| `e2e/workflow-signals.spec.ts` | 290 | 11 个 E2E |

## 设计亮点

- **trigger 链**: hitl_requests UPDATE → tg_hitl_to_workflow_signal → INSERT workflow_signals. 自动从 hitl.payload 提取 decision / decided_by / decided_at / note.
- **幂等 ON CONFLICT**: UNIQUE (hitl_request_id) + ON CONFLICT DO UPDATE. 同一 hitl 重复决策会覆盖 payload 并重置 pending (Temporal worker 重新发送 signal).
- **Realtime**: supabase_realtime publication add workflow_signals. 生产 Temporal worker 用 Realtime WS 订阅 status='pending', 低延迟推送.
- **三态 FSM**: pending → sent (worker 调 Temporal signal 完成) → acknowledged (workflow ack). failed + error 字段保留失败原因.

## 下一步 (Loop 3/3)

- M22 多级审批超时升级 (pg_cron 每小时扫 pending 超时 → 升级到 B/C/D approver)
- mp-workflow Temporal worker: 订阅 workflow_signals Realtime → 调 workflow.signal()
- 钉钉 / 飞书 / 企微审批 SaaS 适配 (M46-M49)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M13 HITL Hub | decide-hitl → tg_hitl_to_workflow_signal (本 Loop 1/3+2/3) |
| M17 Temporal worker | 订阅 workflow_signals pending (生产) |
| M40 Workflow 引擎 | 接收 signal 'hitl_decision' 恢复 workflow |
| M22 多级超时 | pg_cron 扫 workflow_signals 卡 pending 超时 → 自动升级 approver |

---

*MetaPlatform-HITL-HUB-01 Loop 2/3 — 2026-08-21 — 11/11 E2E PASS, 0 bug*