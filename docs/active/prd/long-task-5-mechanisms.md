# PRD：long-task-5-mechanisms

> **模块**：1 周+ 长任务 5 大机制完整版
> **对应 Batch**：[MP-V6-LONG-TASK-01](../batch/MP-V6-LONG-TASK-01.md)
> **状态**：Draft v1.0
> **负责人**：后端 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

完整实现 1 周+ 长审批任务的 5 大机制：多级超时升级 + pending_approval 冻结 + webhook + polling 双对账 + 自动 reminder + context 双写。

## 2. 背景与目标

### 2.1 背景

- v3.0 短审批（无 1 周+ 长任务支持）
- v6.0 长任务需要 5 大机制（spec §7.10）
- HITL-HUB-01 + APPROVAL-01 已部分实现

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 多级超时升级链（24h→B / 48h→C / 72h→D）完整化 |
| G2 | pending_approval 冻结（DB trigger）完整化 |
| G3 | webhook + polling 双对账 |
| G4 | 自动 reminder（每日 09:00） |
| G5 | Context 双写 + audit |
| G6 | 1 周+ 长审批 E2E |
| G7 | HITL Health dashboard + Prometheus alert |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 提交 7 天审批 → 每天 09:00 收到 reminder → 24h/48h/72h 升级到 B/C/D |
| SRE | 监控 pending HITL 数 + 平均审批时长 |
| 架构师 | 调试长任务 context (通过 hitl_requests.context JSONB) |

## 4. 功能需求

### 4.1 5 大机制完整化

1. **多级超时升级**：每 15 分钟 cron 检查，升级 escalation_level + 通知下一审批人
2. **pending_approval 冻结**：DB trigger 阻止业务变更
3. **webhook + polling 双对账**：webhook 接收 + cron 兜底轮询
4. **自动 reminder**：每日 09:00 给所有 pending 审批人发 reminder
5. **Context 双写**：hitl_requests.context JSONB 字段 + audit_log 写 decision 事件

### 4.2 pg_cron jobs

| Cron | 频率 | 任务 |
|---|---|---|
| `hitl-multi-level-escalation` | 每 15 分钟 | 升级 + 通知 |
| `hitl-poll-reconcile` | 每 30 分钟 | webhook 丢失兜底 |
| `hitl-reminder-daily` | 每天 09:00 | reminder  |
| `hitl-context-cleanup` | 每周 | 30 天前 context 归档 |

### 4.3 Long-task SDK

```typescript
// packages/mp-long-task/src/index.ts
// 业务 Batch 调用:
import { LongTaskClient } from '@mp/long-task';

const task = new LongTaskClient({ supabaseUrl, supabaseKey });

await task.create({
  tenantId,
  type: 'contract_approval',
  context: { contract_id, amount },
  approvers: [...],
  timeoutMs: 7 * 24 * 60 * 60 * 1000,  // 7 天
  escalationChain: [
    { level: 0, approverUserIds: ['manager-1'], timeoutHours: 24 },
    { level: 1, approverUserIds: ['director-1'], timeoutHours: 48 },
    { level: 2, approverUserIds: ['vp-1'], timeoutHours: 72 },
    { level: 3, action: 'expire' },
  ],
});
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| Reminder 延迟 | < 1 分钟（cron 09:00） |
| 升级通知 | < 1 分钟（cron 每 15 分钟） |
| Polling 兜底 | < 30 分钟（cron） |

## 6. 接口契约

### 6.1 long_tasks 表（扩展 hitl_requests）

`hitl_requests` 已存在；long-task 用 type='workflow_saas' + timeout 7 天实现。

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 5 大机制完整 | unit test + 集成 |
| AC2 | pg_cron 4 个 jobs | `SELECT * FROM cron.job;` |
| AC3 | 1 周+ E2E | staging 演练 |
| AC4 | HITL Health dashboard | Grafana |
| AC5 | Prometheus alert | 6 规则 |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| HITL Hub | MP-V6-HITL-HUB-01 ✅ |
| Approval SaaS | MP-V6-APPROVAL-01 ✅ |
| pg_cron | Supabase 内置 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| Reminder 漏发 | cron retry + 监控 |
| 升级不及时 | cron 每 15 分钟 |
| Polling 兜底资源消耗 | limit 100/batch + skip locked |

## 10. 不做

- ❌ 自建长任务框架（用 Temporal + hitl_requests）
- ❌ 邮件通知（v6.0 用 SaaS）

---

*PRD v1.0 — 配套 [MP-V6-LONG-TASK-01 Batch](../batch/MP-V6-LONG-TASK-01.md)*