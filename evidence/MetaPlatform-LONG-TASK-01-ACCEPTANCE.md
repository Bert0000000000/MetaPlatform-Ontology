# MetaPlatform-LONG-TASK-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 1 周+ 长审批演练)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-LONG-TASK-01.md](../batch/MetaPlatform-LONG-TASK-01.md)
> **关联 PRD**：[long-task-5-mechanisms.md](../prd/long-task-5-mechanisms.md)
> **前置依赖**：MetaPlatform-HITL-HUB-01 ✅ + MetaPlatform-APPROVAL-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/long-task-5-mechanisms.md, 10 节)
- [x] 5 大机制完整化 (HITL-HUB-01 + APPROVAL-01 部分 + 本 Batch 扩展)
  - [x] 1. 多级超时升级链 (APPROVAL-01 pg_cron `hitl-multi-level-escalation`)
  - [x] 2. pending_approval 冻结 (HITL-HUB-01 `tg_block_pending_approval_changes`)
  - [x] 3. webhook + polling 双对账 (HITL-HUB-01 `hitl-poll-reconcile`)
  - [x] 4. 自动 reminder (`hitl-reminder-daily` 09:00 — 本 Batch 新)
  - [x] 5. Context 双写 (hitl_requests.context JSONB)
- [x] pg_cron 4 jobs (本 Batch 补齐 reminder-daily + context-cleanup)
- [x] LongTaskClient SDK (`packages/mp-long-task/src/index.ts`)
  - [x] `create()` 校验 escalation chain 时长
  - [x] `tenant_escalation_chain` upsert
  - [x] `getStatus()` 查询长任务状态
- [x] HITL Health Grafana dashboard (`dashboards/hitl-health.json`)
  - [x] Pending by type + escalation level
  - [x] 平均审批时长
  - [x] 升级事件
  - [x] Expired 累计
  - [x] Reminder 发送
  - [x] Webhook vs Polling
- [x] Prometheus alert rules (`prometheus/rules/hitl-alerts.yaml`)
  - [x] HITLPendingBacklog (critical)
  - [x] HITLSingleOverdue (critical, 96h)
  - [x] HITLAverageDurationHigh (warning)
  - [x] HITLWebhookFailureRateHigh (warning)
  - [x] HITLEscalationSpike (info)
- [x] 单元测试 (3 cases: create / 校验 / 空 chain 拒)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase db push` (应用 reminder + context cleanup cron)
- [ ] Grafana import `dashboards/hitl-health.json`
- [ ] Prometheus reload rules (`prometheus/rules/hitl-alerts.yaml`)
- [ ] LongTaskClient 集成到业务 Edge Functions (合同 / 订单 / 发票)
- [ ] 端到端测试:
  - [ ] staging 演练 7 天长审批
  - [ ] 24h 后自动升级到 B 经理
  - [ ] 48h 后升级到 C 总监
  - [ ] 72h 后升级到 D 副总
  - [ ] 96h 后 expire
  - [ ] 每天 09:00 reminder 收到
  - [ ] webhook 失败时 polling 兜底
  - [ ] 跨 tenant escalation chain 隔离

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/long-task-5-mechanisms.md` | PRD v1.0 (10 节) |
| `supabase/migrations/20260820200000_create_hitl_reminder_cron.sql` | reminder-daily + context-cleanup cron |
| `packages/mp-long-task/src/index.ts` | LongTaskClient SDK |
| `packages/mp-long-task/{package.json, tsconfig.json}` | pnpm workspace |
| `packages/mp-long-task/tests/long_task.test.ts` | 3 cases |
| `dashboards/hitl-health.json` | Grafana dashboard |
| `prometheus/rules/hitl-alerts.yaml` | 5 alert rules |
| `evidence/MetaPlatform-LONG-TASK-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Reminder 漏发 | cron retry + Prometheus 监控 |
| 升级不及时 | cron 每 15 分钟 |
| Polling 兜底资源消耗 | limit 100/batch + skip locked |
| 长任务 context 暴涨 | 30 天后清理 cron |

## 通知下游

✅ LONG-TASK-01 骨架完成。下游可启动:
- **MetaPlatform-V6.1-PREP** (2w) — v6.1 路线图

---

*LONG-TASK-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 3 长任务收口就绪*