# MP-V6-HITL-HUB-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 pg_cron + E2E 验证)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-HITL-HUB-01.md](../batch/MP-V6-HITL-HUB-01.md)
> **关联 PRD**：[hitl-hub.md](../prd/hitl-hub.md)
> **前置依赖**：MP-V6-AUTH-01 ✅ + MP-V6-TEMPORAL-01 ✅

---

## 验收标准（AC）

- [x] `public.hitl_requests` 表（已在 FOUNDATION）+ 4 HITL 类型 enum + 5 status enum + 4 RLS policies
- [x] HITL Hub SDK (`packages/mp-hitl-hub/src/index.ts`)
  - [x] `requestHitl()` — 创建 + Realtime broadcast + SaaS 派发
  - [x] `decideHitl()` — 更新 + Temporal signal + Realtime broadcast
  - [x] 7 天 timeout 上限校验
- [x] 长任务 5 大机制 (`supabase/migrations/20260820160000_create_hitl_long_task_cron.sql`)
  - [x] 机制 1+3+4: pg_cron 每小时 timeout check + escalation_level 自动升级
  - [x] 机制 2: `tg_block_pending_approval_changes` DB trigger (pending 状态冻结)
  - [x] 机制 3: `hitl-poll-reconcile` cron 每 30 分钟 polling 兜底
  - [x] 机制 5: `hitl_requests.context` JSONB 双写
- [x] `public.hitl_poll_queue` 表（webhook 丢失兜底）+ RLS
- [x] HITL Hub 单元测试 (`packages/mp-hitl-hub/tests/hitl_hub.test.ts`, 4 cases)
- [x] 4 HITL 类型测试覆盖
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase db push` (应用 hitl_long_task_cron migration)
- [ ] pg_cron 启用验证: `SELECT * FROM cron.job;`
- [ ] 3 家 SaaS 适配层 (钉钉/飞书/企微) 申请 app + 注入凭证
- [ ] 端到端测试:
  - [ ] workflow_saas: 合同审批 → 钉钉收到 → 用户同意 → Temporal signal → workflow 恢复
  - [ ] workflow_dsh: < 1 小时审批 → dsh Web 弹窗 → 用户确认
  - [ ] tool_dsh: dsh agent 调敏感 tool → HITL 弹窗 → 用户确认 → tool 放行
  - [ ] action_confirm: apply-ontology-change preview → 用户确认 → applyOntologyChangeWorkflow 启动
- [ ] 长任务 24h+ 测试 (timeout escalation 1→2→3→expired)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `packages/mp-hitl-hub/src/index.ts` | HITL Hub SDK (requestHitl / decideHitl) |
| `packages/mp-hitl-hub/{package.json, tsconfig.json}` | pnpm workspace 包 |
| `packages/mp-hitl-hub/tests/hitl_hub.test.ts` | 4 cases |
| `supabase/migrations/20260820160000_create_hitl_long_task_cron.sql` | 长任务 5 大机制 pg_cron |
| `supabase/functions/hitl-webhook/index.ts` | (MIGRATION 已有) SaaS callback receiver |
| `supabase/functions/dsp-webhook/index.ts` | (已有) HITL Realtime broadcast |
| `docs/active/batch/MP-V6-HITL-HUB-01.md` | Batch doc |
| `docs/active/prd/hitl-hub.md` | PRD v1.0 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| SaaS webhook 丢失 | hitl-poll-reconcile cron 每 30 min 兜底 |
| 长任务 context 丢失 | hitl_requests.context JSONB 双写 |
| 单点故障 | HITL Hub 本身多副本 (Phase E 计划) |
| 超时升级失败 | cron retry + escalation_level 上限 3 |

## 通知下游

✅ HITL-HUB-01 骨架完成。下游可启动:
- **MP-V6-APPROVAL-01** (6w) — 第三方审批 SaaS 多级超时升级
- **MP-V6-LONG-TASK-01** (4w) — 1 周+ 长任务 5 大机制 (本 Batch 已部分实现)

---

*HITL-HUB-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 1 HITL 联动中枢就绪*