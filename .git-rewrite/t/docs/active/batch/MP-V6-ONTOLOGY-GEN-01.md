# MP-V6-ONTOLOGY-GEN-01 — 本体生成 + 预览

> **Batch 状态**：Pending Acceptance
> **优先级**：🟡 P2
> **工作量**：4 周
> **团队**：AI 团队 + 后端
> **前置依赖**：MP-V6-AUTH-01 + MP-V6-HITL-HUB-01

---

## 1. 目标

实现 12 Ontology Kernel 的本体生成 + dsh 预览 + HITL 落库流程。

## 2. 配套文档

- 技术架构 spec：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](../../specs/2026-08-19-mp-v6-architecture.md) §7.15

## 3. 核心交付

| 项 | 验证 |
|---|---|
| `public.ontology_object_types` + `ontology_action_types` + `pending_object_changes`（已在 FOUNDATION 创建） | ✅ |
| dsh "ontology-curator" preset | `apps/dsh-presets/ontology-curator/` |
| `apply-ontology-change` Edge Function（已 skeleton） | E2E 测试 |
| HITL Hub `action_confirm` 集成 | E2E 测试 |
| Ontology diff viewer UI | React + Semi Design |

## 4. 详细任务清单

### 第 1 周：dsh preset + schema
- [ ] ontology-curator preset 配置
- [ ] 12 个 Ontology Kernel 的 schema 定义
- [ ] dsh tool: read ontology + propose change

### 第 2 周：apply-ontology-change Edge Function
- [ ] 完善 `supabase/functions/apply-ontology-change/`
- [ ] mode='preview' → previewOntologyChangeWorkflow
- [ ] mode='confirmed' → applyOntologyChangeWorkflow
- [ ] E2E 测试

### 第 3 周：Temporal workflow + HITL
- [ ] previewOntologyChangeWorkflow（生成 diff + 弹 HITL）
- [ ] applyOntologyChangeWorkflow（事务性应用 + audit_log）
- [ ] HITL `action_confirm` 集成（4 类型之一）

### 第 4 周：UI + evidence
- [ ] Ontology diff viewer React 组件
- [ ] 端到端: dsh 提出变更 → HITL 弹窗 → 用户确认 → apply
- [ ] evidence/MP-V6-ONTOLOGY-GEN-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 12 Ontology Kernel schema 定义完整
- [ ] dsh ontology-curator preset
- [ ] apply-ontology-change Edge Function
- [ ] preview + apply Temporal workflows
- [ ] HITL action_confirm 集成
- [ ] Diff viewer UI
- [ ] evidence 完成

---

*MP-V6-ONTOLOGY-GEN-01 — Sprint 1 本体生成就绪*