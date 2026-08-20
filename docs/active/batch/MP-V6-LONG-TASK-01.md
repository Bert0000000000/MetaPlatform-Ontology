# MP-V6-LONG-TASK-01 — 1 周+ 长任务 5 大机制完整版

> **Batch 状态**：Pending Acceptance
> **优先级**：🟡 P3
> **工作量**：4 周
> **团队**：后端 + SRE
> **前置依赖**：MP-V6-HITL-HUB-01 ✅ + MP-V6-APPROVAL-01 ✅

---

## 1. 目标

完整实现 1 周+ 长审批任务的 5 大机制：多级超时升级 + pending_approval 冻结 + webhook + polling 双对账 + 自动 reminder + context 双写。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §7.10
- 已有 PRD：`docs/active/prd/hitl-hub.md` §4.2 (HITL-HUB-01 部分实现)

## 3. 核心交付

| 项 | 验证 |
|---|---|
| 多级超时升级链 (24h→B / 48h→C / 72h→D) | APPROVAL-01 已部分实现 |
| pending_approval 状态冻结 (DB trigger) | HITL-HUB-01 已实现 |
| webhook + polling 双对账 | HITL-HUB-01 已实现 |
| 自动 reminder (pg_cron) | 本 Batch 完整化 |
| Context 双写 (hitl_requests.context + audit_log) | 本 Batch 完整化 |
| 长任务 1 周+ E2E | staging 演练 |

## 4. 详细任务清单

### Week 1：Reminder + Escalation 完整化
- [ ] pg_cron `hitl-reminder-daily` (每天 09:00 给所有 pending 审批人发 reminder)
- [ ] pg_cron `hitl-escalation-progressive` (每 15 分钟检查升级, 完整版)
- [ ] Realtime broadcast escalation events

### Week 2：Context 双写 + Audit
- [ ] hitl_requests.context 双写 (审批触发时快照完整业务 context)
- [ ] audit_log 写 escalation / decision 事件
- [ ] 长任务状态查询 SDK (`packages/mp-long-task/`)

### Week 3：长任务 1 周+ E2E
- [ ] staging 演练 7 天审批
- [ ] 多级升级链验证 (24h→B→C→D→expired)
- [ ] 跨 tenant 隔离测试

### Week 4：监控 + Evidence
- [ ] Prometheus metrics (pending HITL 数, escalation 数, 平均审批时长)
- [ ] Grafana dashboard (HITL Health)
- [ ] evidence/MP-V6-LONG-TASK-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 5 大机制完整版
- [ ] 1 周+ 长审批 E2E
- [ ] Prometheus 监控
- [ ] evidence 完成

---

*MP-V6-LONG-TASK-01 — Sprint 3 长任务收口*