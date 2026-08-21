# MetaPlatform-ONTOLOGY-GEN-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 dsh preset 应用 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-ONTOLOGY-GEN-01.md](../batch/MetaPlatform-ONTOLOGY-GEN-01.md)
> **关联 PRD**：[ontology-gen.md](../prd/ontology-gen.md)
> **前置依赖**：MetaPlatform-AUTH-01 ✅ + MetaPlatform-HITL-HUB-01 ✅ + MetaPlatform-TEMPORAL-01 ✅ + MetaPlatform-DSH-01 ✅

---

## 验收标准（AC）

- [x] `public.ontology_object_types` + `ontology_action_types` + `pending_object_changes` (已在 FOUNDATION)
- [x] dsh ontology-curator preset (`apps/dsh-presets/ontology-curator/cordis.yml`, 7/7 preset 第 3 个)
  - [x] tools: propose_ontology_change / apply_ontology_change / read_ontology / search_ontology / list_pending_changes
  - [x] state machine: running → waiting_hitl → completed/cancelled
- [x] Temporal workflows (`packages/mp-temporal-worker-template/src/workflows/ontology.ts`)
  - [x] `previewOntologyChangeWorkflow` (读 change → 生成 diff → 写 hitl_requests → Realtime broadcast)
  - [x] `applyOntologyChangeWorkflow` (校验 HITL → 事务性应用 → audit → Realtime)
- [x] `apply-ontology-change` Edge Function (完整实现)
  - [x] mode='preview' 且无 change_id: 自动 INSERT pending_object_changes
  - [x] 启动对应 Temporal workflow
- [x] Diff viewer React 组件 (`apps/web/src/components/OntologyDiff/OntologyDiffViewer.tsx`)
  - [x] Semi Design Table + Tag (added/removed/modified/unchanged 颜色)
  - [x] 批准/拒绝按钮
- [x] Diff viewer 单元测试 (`tests/ontology/diff_viewer.test.ts`, 3 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `supabase db push` (应用已写好的 20 个 migration)
- [ ] `packages/mp-temporal-worker-template/src/workflows/ontology.ts` 注册到 worker entry
- [ ] 端到端测试:
  - [ ] dsh ontology-curator 对话 → 生成 ObjectType 草稿 → preview workflow 启动 → HITL 弹窗
  - [ ] 用户在 Diff Viewer 批准 → apply workflow 启动 → 事务性应用 → audit_log
  - [ ] 跨 tenant 测试: tenant A 不能批准 tenant B 的本体变更 (RLS 隔离)
  - [ ] 并发测试: 两个 apply workflow 同时跑同一个 change_id → advisory lock 防冲突
- [ ] ontology 生成 UI 测试 (前端 React 组件)

## 已交付文件

| 文件 | 说明 |
|---|---|
|  `docs/active/prd/ontology-gen.md` | PRD v1.0 (10 节) |
|  `apps/dsh-presets/ontology-curator/cordis.yml` | 7/7 preset 第 3 个 |
|  `packages/mp-temporal-worker-template/src/workflows/ontology.ts` | preview + apply workflows |
|  `supabase/functions/apply-ontology-change/index.ts` | (DSH-01 skeleton → 现在完整) |
|  `apps/web/src/components/OntologyDiff/OntologyDiffViewer.tsx` | React Diff viewer |
|  `tests/ontology/diff_viewer.test.ts` | 3 cases |
|  `docs/active/batch/MetaPlatform-ONTOLOGY-GEN-01.md` | Batch doc |
|  `evidence/MetaPlatform-ONTOLOGY-GEN-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 生成错误 schema | HITL 必走 + Diff viewer 人工审 |
| 并发应用冲突 | Postgres advisory lock (workflow 内) |
| 应用失败 | rollback + audit_log 记录失败原因 |
| 误应用 | HITL action_confirm 类型, 必须 explicit approve |

## 通知下游

✅ ONTOLOGY-GEN-01 骨架完成。下游可启动:
- **MetaPlatform-EDGE-FN-01** (6w) — 17 域业务迁移到 Edge Functions (ontology 是 Kernel 基础)

---

*ONTOLOGY-GEN-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 1 本体生成就绪*