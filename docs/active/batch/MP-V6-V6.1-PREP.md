# MP-V6-V6.1-PREP — v6.1 路线图准备

> **Batch 状态**：Pending Acceptance
> **优先级**：⚪ P4（探索）
> **工作量**：2 周
> **团队**：架构组 + AI 团队
> **前置依赖**：Sprint 0/1/2/3 完成

---

## 1. 目标

为 v6.1 演进做技术调研 + 路线图：罗盘 / 应用中心 / 云市场 / Schema 版本管理。

## 2. 候选 v6.1 特性

| 特性 | 说明 | 调研重点 |
|---|---|---|
| **罗盘 (Compass)** | 业务智能仪表盘 (类 Tableau / Metabase) | dsh 数字员工自动生成 dashboard |
| **应用中心 (App Center)** | 数字员工 preset 市场 | 多租户 preset 共享 + 版本管理 |
| **云市场 (Marketplace)** | 第三方插件 marketplace | K8s Operator + 三方 SaaS 接入 |
| **Schema 版本管理** | ontology_object_types 多版本并存 | temporal_workflow version + migration tool |
| **多模态 RAG** | image / video embedding | clip-vit / video-blip |
| **SAML SSO** | 企业级 SSO | 企业客户需求 |

## 3. 详细任务清单

### Week 1：调研
- [ ] 6 个候选特性分别写 1-page 设计草案
- [ ] 评估工作量 / 依赖 / 风险
- [ ] 推荐 v6.1 必须 / 可选 / 推迟 三档

### Week 2：ADR + 路线图
- [ ] 写 ADR-NNNN (每个候选 1 个 ADR)
- [ ] v6.1 路线图文档
- [ ] evidence/MP-V6-V6.1-PREP-ACCEPTANCE.md

## 4. 验收标准（AC）

- [ ] 6 个候选 ADR
- [ ] 路线图文档
- [ ] evidence 完成

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| v6.1 范围蔓延 | 严格 must/可选/推迟分级 |
| 调研超 2 周 | 限定每特性 1-page 设计 |

---

*MP-V6-V6.1-PREP — Sprint 3 v6.1 路线图*