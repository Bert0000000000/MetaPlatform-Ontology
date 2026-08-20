# PRD：hitl-hub

> **模块**：HITL Hub 联动中枢（4 种 HITL 类型 + 长任务 5 大机制）
> **对应 Batch**：[MP-V6-HITL-HUB-01](../batch/MP-V6-HITL-HUB-01.md)
> **状态**：Draft v1.0
> **负责人**：SRE + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

实现 HITL Hub 联动中枢，统一 4 种 HITL 类型（workflow_saas / workflow_dsh / tool_dsh / action_confirm），与 dsh + Temporal + 第三方 SaaS 协同，支持 1 周+ 长任务的 5 大机制（多级超时升级 + reminder + 双对账）。

## 2. 背景与目标

### 2.1 背景

- v3.0 审批流用 Flowable BPMN（Java），能力上限明显
- v6.0 切到 HITL Hub 4 种类型 + 第三方 SaaS（钉钉/飞书/企微）
- 长审批（1 周+）需要多级超时升级 + 持久化 context

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 4 种 HITL 类型完整实现 + Realtime 推送 |
| G2 | Temporal signal 唤醒 workflow |
| G3 | 3 家 SaaS 适配层（钉钉/飞书/企微） |
| G4 | 长任务 5 大机制（pg_cron 驱动） |
| G5 | E2E：合同审批 → 钉钉 → Temporal signal → workflow 恢复 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 在钉钉收到审批 → 点同意 → workflow 自动恢复 |
| AI 数字员工 | dsh 调 tool 时遇到敏感操作 → 弹 HITL 弹窗 → 用户确认 → 继续 |
| SRE | 监控 hitl_requests pending 数 + SaaS webhook 失败率 |

## 4. 功能需求

### 4.1 4 种 HITL 类型

| 类型 | 触发者 | 审批位置 | 适用 |
|---|---|---|---|
| `workflow_saas` | 业务 workflow | 钉钉/飞书/企微 | 1 周+ 审批 |
| `workflow_dsh` | 业务 workflow | dsh Web | < 1 小时 |
| `tool_dsh` | 数字员工作业 | dsh Web | 敏感 tool |
| `action_confirm` | ActionType.apply | dsh Web | AI 提案预览 |

### 4.2 长任务 5 大机制

| 机制 | 实现 |
|---|---|
| 多级超时升级 | pg_cron 每小时检查 timeout_at, 升级 escalation_level + 通知下一审批人 |
| pending 状态冻结 | DB trigger 阻止业务变更 |
| webhook + polling 双重对账 | pg_cron 每 30 分钟 polling 兜底 |
| reminder + 升级 | pg_cron 每日 09:00 reminder |
| 关键 context 持久化 | hitl_requests.context JSONB 字段 |

### 4.3 HITL Hub Service (Node SDK)

```typescript
// packages/mp-hitl-hub/src/index.ts
import { createHitlHub } from '@mp/hitl-hub';

const hub = createHitlHub({ supabaseUrl, supabaseKey });

await hub.requestHitl({
  tenantId: 'tenant-A',
  type: 'workflow_saas',
  title: '审批合同',
  context: { contract_id: 'xxx' },
  approverUserIds: ['user-1'],
  timeoutAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| Realtime 延迟 | < 500ms p95 |
| 长任务 RTO | < 30 分钟（多级升级 + webhook 双对账） |
| 持久化 | hitl_requests 7 年保留（合规） |
| 多租户 | RLS 强制（已在 FOUNDATION） |

## 6. 接口契约

### 6.1 HITL Hub SDK

```typescript
interface HitlRequest {
  tenantId: string;
  type: 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_conf';
  title: string;
  description?: string;
  context: Record<string, unknown>;
  approverUserIds: string[];
  timeoutAt: Date;          // ISO 8601, 最大 7 天
  workflowId?: string;      // Temporal workflow ID (workflow_saas 类型)
  escalationLevel?: number;  // 默认 0
}

interface HitlResponse {
  id: string;                // UUID
  status: 'pending';
  timeoutAt: Date;
}
```

### 6.2 Realtime 推送

```typescript
// Supabase Realtime channel
supabase.channel(`hitl:${tenantId}`)
  .on('broadcast', { event: 'hitl_request_created' }, (payload) => { /* ... */ })
  .on('broadcast', { event: 'hitl_decision_made' }, (payload) => { /* ... */ })
  .subscribe();
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 4 种 HITL 类型完整 E2E | 集成测试 |
| AC2 | Realtime 推送延迟 < 500ms | load test |
| AC3 | Temporal signal 集成 | unit test |
| AC4 | 5 大长任务机制 | pg_cron + integration test |
| AC5 | 3 家 SaaS 适配层 | 单元测试 + 钉钉 mock |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG + RLS | MP-V6-FOUNDATION-01 ✅ |
| Realtime | MP-V6-FOUNDATION-01 ✅ |
| Temporal Worker | MP-V6-TEMPORAL-01 ✅ |
| 钉钉/飞书/企微 app 凭证 | SRE 申请 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| SaaS webhook 丢失 | webhook + polling 双对账 |
| 长任务 context 丢失 | hitl_requests.context 双写 |
| 单点故障 | HITL Hub dsh service 多副本 |
| 超时升级失败 | pg_cron retry 兜底 |

## 10. 不做

- ❌ 自建审批引擎（用 4 种类型 + SaaS）
- ❌ Flowable BPMN（v3.0 抛弃）
- ❌ 邮件通知（v6.0 用 SaaS, v6.1 评估）

---

*PRD v1.0 — 配套 [MP-V6-HITL-HUB-01 Batch](../batch/MP-V6-HITL-HUB-01.md)*