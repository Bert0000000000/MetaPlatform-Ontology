# MetaPlatform-RAG-01 — RAGFlow + GraphRAG 集成

> **Batch 状态**：Pending Acceptance
> **优先级**：🟡 P2
> **工作量**：4 周
> **团队**：AI 团队 + 后端
> **前置依赖**：MetaPlatform-AI (mp-ai ns) + Supabase Vector

---

## 1. 目标

部署 RAGFlow（文档 RAG）+ Microsoft GraphRAG（KG RAG），双路并行检索 + 融合 + 接入 knowledge-curator preset。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §3.1 / §6.6
- PRD（待补）：`docs/active/prd/rag-dual-engine.md`

## 3. 核心交付

| 项 | 验证 |
|---|---|
| RAGFlow 部署 (mp-ai ns) | `kubectl get pods -n mp-ai -l app=ragflow` |
| GraphRAG 部署 | 同上 |
| 双路检索 Edge Function | `supabase functions list` |
| knowledge-curator preset 集成 | E2E 测试 |
| 命中率达 90% (基于 dev 测试集) | 评估报告 |

## 4. 详细任务清单

### Week 1：RAGFlow 部署
- [ ] RAGFlow Helm chart (或 Docker)
- [ ] 文档摄取 pipeline (PDF / DOCX / Markdown)
- [ ] BM25 + 向量检索

### Week 2：GraphRAG 部署
- [ ] Microsoft GraphRAG 部署 (Python 服务)
- [ ] KG 抽取 pipeline
- [ ] Leiden 社区检测
- [ ] 全局摘要生成

### Week 3：双路融合
- [ ] 双路并行检索 Edge Function
- [ ] 结果融合 + 去重 + 排序
- [ ] knowledge-curator preset 集成

### Week 4：评估 + E2E
- [ ] 命中率评估 (dev 测试集)
- [ ] 端到端 E2E 测试
- [ ] evidence/MetaPlatform-RAG-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] RAGFlow + GraphRAG 部署
- [ ] 双路融合 Edge Function
- [ ] knowledge-curator 集成
- [ ] 命中率 ≥ 90%
- [ ] E2E 测试
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| GraphRAG LLM 成本高 | token meter + 预留 limit |
| 文档摄取失败 | 重试 + dead letter queue |
| 命中率不达标 | 评估迭代 + 人工标注反馈 |

---

*MetaPlatform-RAG-01 — Sprint 2 双 RAG 引擎就绪*