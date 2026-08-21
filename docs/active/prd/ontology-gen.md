# PRD：ontology-gen

> **模块**：本体生成 + dsh 预览 + HITL 落库
> **对应 Batch**：[MetaPlatform-ONTOLOGY-GEN-01](../batch/MetaPlatform-ONTOLOGY-GEN-01.md)
> **状态**：Draft v1.0
> **负责人**：AI 团队 + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

实现 12 Ontology Kernel 的本体生成 + dsh "ontology-curator" 预设 + 预览 + HITL 落库流程。

## 2. 背景与目标

### 2.1 背景

- v6.0 重新设计 17 域 ObjectType（per architecture spec §7.15）
- 12 Ontology Kernel: ObjectType / ActionType / LinkType / PropertyType 等
- dsh 数字员工 `ontology-curator` 负责分析需求 → 提议本体变更
- HITL Hub `action_confirm` 让用户预览 diff 后批准

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | dsh ontology-curator preset (Cordis 配置) |
| G2 | `apply-ontology-change` Edge Function (mode: preview / confirmed) |
| G3 | Temporal workflows (previewOntologyChange + applyOntologyChange) |
| G4 | HITL `action_confirm` 集成 |
| G5 | Diff viewer React 组件 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务架构师 | 跟 ontology-curator 对话 → 生成 ObjectType 草稿 → 预览 → 批准 |
| DBA | 审批后事务性应用到 PG + audit_log |
| 数字员工 | dsh tool: propose_ontology_change (call Edge Function) |

## 4. 功能需求

### 4.1 ontology-curator preset

- 系统提示: "分析用户需求 → 生成 ObjectType/ActionType/LinkType 草稿"
- 工具: `propose_ontology_change(type, payload)` → 调 Edge Function
- 输出: `pending_object_changes` INSERT + `hitl_requests` (action_confirm)

### 4.2 apply-ontology-change Edge Function

```typescript
// supabase/functions/apply-ontology-change/index.ts
// mode='preview' → previewOntologyChangeWorkflow
// mode='confirmed' → applyOntologyChangeWorkflow
```

### 4.3 Temporal Workflows

#### previewOntologyChangeWorkflow
1. 读 pending_object_changes
2. 生成 unified diff (JSON)
3. 写 hitl_requests (type=action_confirm, timeout 24h)
4. Realtime broadcast (前端 Diff viewer 立即显示)
5. Wait signal 'approval' 或 timeout → 结束

#### applyOntologyChangeWorkflow
1. 接收 preview_id + approval
2. 事务性应用本体变更 (INSERT/UPDATE ObjectType/ActionType)
3. 写 audit_log
4. 更新 pending_object_changes.status='applied'
5. Realtime broadcast (前端刷新 schema)

### 4.4 Diff Viewer

```typescript
// apps/web/src/components/OntologyDiff/OntologyDiffViewer.tsx
// Semi Design Table 展示 old/new 字段对比
// 高亮: added (green) / removed (red) / modified (yellow)
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 响应 | preview < 5s p95 |
| 事务性 | apply 必须 PG 事务包裹 |
| 审计 | 100% 进 audit_log |
| 权限 | 仅架构师 / DBA 可批 |

## 6. 接口契约

### 6.1 Edge Function 输入

```typescript
interface ApplyRequest {
  change_id: string;          // pending_object_changes.id
  mode: 'preview' | 'confirmed';
}
```

### 6.2 pending_object_changes 表

```sql
CREATE TABLE public.pending_object_changes (
    id              uuid PRIMARY KEY,
    tenant_id       uuid NOT NULL,
    object_type_rid text NOT NULL,
    change_type     text NOT NULL,  -- 'create' | 'update' | 'delete' | 'rename'
    payload         jsonb,
    diff            jsonb,
    status          text DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'|'applied'|'cancelled'
    -- (已在 FOUNDATION 20260820130800 创建)
);
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | ontology-curator preset | cordis.yml |
| AC2 | apply-ontology-change Edge Function | unit test + e2e |
| AC3 | previewOntologyChangeWorkflow | Temporal worker test |
| AC4 | applyOntologyChangeWorkflow | 事务性 + audit_log |
| AC5 | HITL action_confirm 集成 | hitl_requests + Realtime |
| AC6 | Diff viewer React 组件 | semi-design 渲染 |
| AC7 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| ontology_* 表 | MetaPlatform-FOUNDATION-01 ✅ |
| HITL Hub | MetaPlatform-HITL-HUB-01 ✅ |
| Temporal Worker | MetaPlatform-TEMPORAL-01 ✅ |
| dsh | MetaPlatform-DSH-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| LLM 生成错误 schema | HITL 必走 + diff viewer 人工审 |
| 并发应用冲突 | Postgres advisory lock |
| 应用失败 | rollback + audit_log 记录失败原因 |

## 10. 不做

- ❌ 自动应用（v6.0 强制 HITL）
- ❌ schema 版本管理（v6.1 评估）
- ❌ 多版本并存（v6.0 单一 active version）

---

*PRD v1.0 — 配套 [MetaPlatform-ONTOLOGY-GEN-01 Batch](../batch/MetaPlatform-ONTOLOGY-GEN-01.md)*