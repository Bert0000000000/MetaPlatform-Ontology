# MetaPlatform-RAG-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 RAGFlow/GraphRAG 部署 + E2E)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-RAG-01.md](../batch/MetaPlatform-RAG-01.md)
> **关联 PRD**：[rag-dual-engine.md](../prd/rag-dual-engine.md)
> **前置依赖**：MetaPlatform-FOUNDATION-01 ✅ + MetaPlatform-LLM-01 ✅ + MetaPlatform-DSH-01 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/rag-dual-engine.md, 10 节)
- [x] `public.documents` 表 (FOUNDATION 已创建, 含 graphrag_entities + ragflow_chunks 字段)
- [x] RAG pipeline package (`packages/mp-rag-pipeline/src/fusion.ts`)
  - [x] `fuseRagResults()` — KG boost (1.2×) + dedup by documentId + sort by score
  - [x] `buildRagContext()` — 格式化 sources 给 dsh llm prompt
- [x] `rag-query` Edge Function (双路并行 + 融合 + dsh llm 生成)
  - [x] RAGFlow: hybrid retrieval (BM25 + 向量) + tenant metadata_filter
  - [x] GraphRAG: KG 检索 + tenant_filter
  - [x] 并行 (Promise.all)
  - [x] dsh llm 生成最终答案
  - [x] Realtime broadcast rag_query_completed
- [x] 单元测试 (`packages/mp-rag-pipeline/tests/fusion.test.ts`, 5 cases)
  - [x] graphrag boost 顺序
  - [x] dedup 保留高分
  - [x] limit 限制
  - [x] buildRagContext 格式
- [x] knowledge-curator preset (DSH-01 已创建, tools 含 ragflow_search + graphrag_search + merge_results + cite_sources)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] 部署 RAGFlow (mp-ai ns): Helm chart 或 Docker
- [ ] 部署 Microsoft GraphRAG (Python 服务)
- [ ] 配置 RAGFLOW_BASE_URL + RAGFLOW_API_KEY (ExternalSecret)
- [ ] 配置 GRAPHRAG_BASE_URL
- [ ] 上传 PDF/DOCX 测试集 (10+ 文档)
- [ ] `supabase functions deploy rag-query`
- [ ] 端到端测试:
  - [ ] knowledge-curator preset → 调 rag-query → 双路检索 → dsh llm 生成答案
  - [ ] 命中率评估 (dev 测试集, 目标 ≥ 90%)
  - [ ] 跨 tenant 隔离 (RLS)
  - [ ] latency p95 < 2s (双路并行 + 融合)
  - [ ] dsp-webhook trigger (documents.INSERT) → rag-ingest pipeline

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/rag-dual-engine.md` | PRD v1.0 (10 节) |
| `packages/mp-rag-pipeline/src/fusion.ts` | fuseRagResults + buildRagContext |
| `packages/mp-rag-pipeline/{package.json, tsconfig.json}` | pnpm workspace 包 |
| `packages/mp-rag-pipeline/tests/fusion.test.ts` | 5 cases |
| `supabase/functions/rag-query/index.ts` | 双路并行 Edge Function |
| `apps/dsh-presets/knowledge-curator/cordis.yml` | (DSH-01 已就绪) |
| `evidence/MetaPlatform-RAG-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| GraphRAG LLM 成本高 | token meter + 预留 limit (LLM-01 已实现) |
| 索引膨胀 | 定期归档 + chunk TTL |
| 命中率不达标 | 评估迭代 + 人工标注反馈 |
| 双路延迟 | 并行检索 + dsh llm streaming |

## 通知下游

✅ RAG-01 骨架完成。下游可启动:
- **MetaPlatform-DEPLOY-01** (2w) — Helm chart + ArgoCD 收口 (Sprint 3 起点)

---

*RAG-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 2 双 RAG 引擎就绪*