# MetaPlatform-LONG-TASK-01 — M22 HITL 多级审批超时升级 ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-LONG-TASK-01.md](../active/batch/MetaPlatform-LONG-TASK-01.md)
> **关联 ADR**:[ADR-0053-hitl-hub.md](../active/decisions/ADR-0053-hitl-hub.md)
> **Module**:M22 多级审批超时升级 + HITL Hub Loop 3/3
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — escalate + expire)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `escalate-hitl` EF (POST, admin/owner): level+1, 新 approver_ids, deadline_at 阶梯 (24h × level) | ✅ |
| AC1.2 | max escalation level 4 → 409 max_escalation | ✅ |
| AC1.3 | 非 pending HITL → 409 not_pending | ✅ |
| AC1.4 | cross-tenant → 403 | ✅ |
| AC1.5 | member role → 403 | ✅ |
| AC1.6 | anon → 401 | ✅ |
| AC1.7 | `expire-overdue-hitl` EF (POST, service_role only): deadline < now() 的 pending → expired | ✅ |
| AC1.8 | pg_cron job `hitl-expire-overdue` (*/5 * * * *) 已 schedule | ✅ |
| AC1.9 | 8/8 E2E PASS | ✅ |

## E2E 结果

```
Running 8 tests using 1 worker
[1/8] 1. escalate-hitl level 0 → 1 + new approvers + deadline_at    (pass)
[2/8] 2. escalate-hitl 2次 → level 2                                (pass)
[3/8] 3. escalate-hitl max level (4) → 409 max_escalation           (pass)
[4/8] 4. escalate-hitl 非 pending → 409 not_pending                 (pass)
[5/8] 5. escalate-hitl member role → 403                            (pass)
[6/8] 6. anon POST → 401                                            (pass)
[7/8] 7. expire-overdue-hitl: HITL with past deadline → status=expired  (pass)
[8/8] 8. pg_cron job 'hitl-expire-overdue' 已 schedule               (pass)

  8 passed (3.2s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/functions/escalate-hitl/index.ts` | 95 | POST 升级 HITL (level + 1 + 新 approver_ids + deadline 阶梯) |
| `supabase/functions/expire-overdue-hitl/index.ts` | 65 | POST 自动 expire (deadline < now), 跨 tenant system-init |
| `supabase/migrations/20260820640000_hitl_pg_cron_expire.sql` | 25 | pg_cron 每 5 分钟调 expire-overdue-hitl |
| `e2e/hitl-escalation.spec.ts` | 250 | 8 个 E2E |

## 多级升级阶梯 (per 模块规划 §M22)

| Level | 含义 | Timeout | 自动升级 (生产) |
|---|---|---|---|
| 0 | A 经理 | 24h | manual |
| 1 | B 总监 | 24h | manual via escalate-hitl |
| 2 | C 副总 | 48h | manual via escalate-hitl |
| 3 | D CEO | 72h | manual via escalate-hitl |
| 4 | max (D + outside counsel) | — | escalate 拒绝 |

## 设计亮点

- **level + deadline_at 联动**: level 1 → +24h, level 2 → +48h, level 3 → +72h. 让 worker / 通知知道 SLA 升级.
- **expire 触发链**: pg_cron (*/5) → EF expire-overdue-hitl → pending 状态行 → expired → workflow_signals (Realtime) → Temporal worker. 完整闭环.
- **Realtime 共享 workflow_signals 表**: 本 Loop 复用 Loop 2/3 的 queue, 无需新表. worker 订阅同一 channel.

## 下一步 (Loop 2/3)

- Loop 2/3: Realtime 监听 hitl_requests UPDATE → 推送 notification (Realtime WS → dsh Web UI 弹窗 + 钉钉 webhook 发送)
- Loop 3/3: 多级审批自动 (AI 决策: 24h 超时自动 escalate, 7 天超时自动 cancel 或标记 stale)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M13 HITL Hub | hitl_requests.deadline_at + escalation_level |
| M22 多级审批 | escalate-hitl EF + pg_cron expire-overdue-hitl |
| M46-M49 审批 SaaS | escalation 通知可走钉钉/飞书/企微 (Loop 3/3) |
| mp-monitoring | pg_cron job 监控 (`hitl-expire-overdue`) |

---

*MetaPlatform-LONG-TASK-01 Loop 1/3 — 2026-08-21 — 8/8 E2E PASS, 0 bug*