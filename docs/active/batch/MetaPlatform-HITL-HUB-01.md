# MetaPlatform-HITL-HUB-01 — HITL Hub 联动中枢

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P1（4 种 HITL 联动中枢）
> **工作量**：4 周
> **团队**：SRE + 后端
> **前置依赖**：MetaPlatform-AUTH-01 + MetaPlatform-TEMPORAL-01

---

## 1. 目标

实现 HITL Hub 联动中枢，统一 4 种 HITL 类型（workflow_saas / workflow_dsh / tool_dsh / action_confirm），与 dsh + Temporal + 第三方 SaaS 协同。

## 2. 配套文档

- 技术架构 spec：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](../../specs/2026-08-19-mp-v6-architecture.md) §6.4 / §7.9

## 3. 核心交付

| 项 | 验证 |
|---|---|
| `public.hitl_requests` 表（已在 FOUNDATION 创建） | 已 ✅ |
| HITL Hub Service (DSH 子) | `dsh hitl request/approve/reject` 命令 |
| 4 种 HITL 类型 E2E 流程 | 端到端测试 |
| Realtime 推送（HITL 面板实时更新） | WebSocket test |
| Temporal signal 集成 | workflow 自动恢复 |
| 长任务 5 大机制（多级超时升级 + reminder + 双对账） | pg_cron + retry |

## 4. 详细任务清单

### 第 1 周：HITL Hub 核心
- [ ] 部署 HITL Hub dsh service
- [ ] 实现 4 种 HITL 类型 registration
- [ ] Realtime 广播集成
- [ ] 单元测试 + 集成测试

### 第 2 周：SaaS 适配
- [ ] 钉钉适配层 (`approval-saas-dingtalk`)
- [ ] 飞书适配层 (`approval-saas-feishu`)
- [ ] 企微适配层 (`approval-saas-wecom`)
- [ ] webhook receiver (`supabase/functions/hitl-webhook/` 已就绪)

### 第 3 周：Temporal 集成
- [ ] HITL signal handler in Temporal worker
- [ ] wait_condition 24h 长任务测试
- [ ] 5 大机制 pg_cron job
- [ ] escalation_level 自动升级测试

### 第 4 周：E2E + evidence
- [ ] 端到端: 合同审批 → dsh HITL → 钉钉审批 → 回写 Temporal
- [ ] 端到端: AI 提案 → action_confirm → 用户预览 → 批准
- [ ] evidence/MetaPlatform-HITL-HUB-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 4 种 HITL 类型完整 E2E 跑通
- [ ] Realtime 推送延迟 < 500ms
- [ ] Temporal signal 集成
- [ ] 5 大长任务机制（多级超时升级 + reminder + 双对账）
- [ ] SaaS 适配层 (3 家)
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| SaaS webhook 丢失 | webhook + polling 双重对账 |
| 长任务 context 丢失 | hitl_requests.context 双写 + 完整 payload |
| 单点故障 | HITL Hub 本身 dsh service 多副本 |
| 超时升级失败 | pg_cron 兜底 retry |

## 7. 下游依赖

- MetaPlatform-APPROVAL-01（第三方审批 SaaS 详细）
- MetaPlatform-LONG-TASK-01（1 周+ 长任务 5 大机制）

---

*MetaPlatform-HITL-HUB-01 — Sprint 1 人在回路中枢就绪*