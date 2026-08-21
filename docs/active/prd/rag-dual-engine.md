# PRD：rag-dual-engine

> **模块**：RAG 双引擎（RAGFlow 文档 RAG + Microsoft GraphRAG KG RAG）
> **对应 Batch**：[MetaPlatform-RAG-01](../batch/MetaPlatform-RAG-01.md)
> **状态**：Draft v1.0
> **负责人**：AI 团队 + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

部署 RAGFlow（文档 RAG：chunk + BM25 + 向量）+ Microsoft GraphRAG（KG RAG：实体抽取 + Leiden 社区 + 全局摘要），双路并行检索 + 融合 + 接入 knowledge-curator preset。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 RAGFlow + LightRAG
- v6.0 切到 RAGFlow + Microsoft GraphRAG（决策 #10，spec §1.1）
- 双引擎互为补充：文档级 + KG 实体级

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | RAGFlow 部署 (mp-ai ns) |
| G2 | GraphRAG 部署 |
| G3 | 文档摄取 pipeline |
| G4 | 双路并行检索 Edge Function |
| G5 | 结果融合 + 去重 + 排序 |
| G6 | knowledge-curator preset 集成 |
| G7 | 命中率 ≥ 90% |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 在 dsh Web 提问 → 知识库回答 + 引用源 |
| DBA | 上传 PDF / DOCX → 自动 chunk + embedding |
| SRE | 监控 RAG 索引大小 + 命中率 + 延迟 |

## 4. 功能需求

### 4.1 RAGFlow 部署（mp-ai ns）

- Helm chart 或 Docker Compose
- 文档摄取: PDF / DOCX / Markdown / HTML
- Chunk 切分 (默认 512 token, overlap 50)
- BM25 + 向量 (text-embedding-3-small) 检索

### 4.2 GraphRAG 部署

- Microsoft GraphRAG Python 服务
- KG 抽取: 实体 + 关系
- Leiden 社区检测
- 全局摘要 + 社区摘要
- 检索: query → 提取实体 → 匹配 KG 子图 → 摘要

### 4.3 双路融合 Edge Function

```typescript
// supabase/functions/rag-query/index.ts
serve(async (req) => {
  const { query, tenant_id, top_k } = await req.json();
  
  // 1. 并行调两路
  const [ragflowResults, graphragResults] = await Promise.all([
    ragflowSearch(query, top_k),
    graphragSearch(query, top_k),
  ]);
  
  // 2. 融合 + 去重
  const merged = mergeResults(ragflowResults, graphragResults);
  
  // 3. dsh llm 生成最终答案
  const answer = await dshLlmGenerate(query, merged);
  
  return { answer, sources: merged.sources };
});
```

### 4.4 文档摄取 pipeline

```typescript
// supabase/functions/rag-ingest/index.ts
// 触发: documents.INSERT (来自 dsp-webhook)
// 1. 读 documents.file_path (Supabase Storage)
// 2. 调 RAGFlow /add_document → chunk + embedding
// 3. 调 GraphRAG /index → 实体抽取 + Leiden
// 4. 更新 documents.graphrag_entities + ragflow_chunks
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 命中率 | ≥ 90% (基于 dev 测试集) |
| 延迟 | 双路并行 + 融合 < 2s p95 |
| 索引大小 | 单租户 < 10GB |
| 多租户 | RLS 强制 |

## 6. 接口契约

### 6.1 RAG Service SDK

```typescript
interface RagQuery {
  query: string;
  tenantId: string;
  topK?: number;       // 默认 10
  presetHints?: string[];
}

interface RagResult {
  sources: Array<{
    type: 'ragflow' | 'graphrag';
    documentId: string;
    snippet: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  answer: string;        // dsh llm 生成
}
```

## 7. 验收标准

| # | 标准 | 验证 |
 |---|---|---|
| AC1 | RAGFlow + GraphRAG 部署 | `kubectl get pods -n mp-ai` |
| AC2 | 双路并行检索 | E2E |
| AC3 | 文档摄取 pipeline | dsp-webhook 触发 |
| AC4 | knowledge-curator 集成 | preset 调通 |
| AC5 | 命中率 ≥ 90% | 评估报告 |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| mp-ai namespace | MetaPlatform-FOUNDATION-01 ✅ |
| Supabase Storage | MetaPlatform-FOUNDATION-01 ✅ |
| documents 表 | MetaPlatform-FOUNDATION-01 ✅ |
| dsh token meter | MetaPlatform-LLM-01 ✅ |
| knowledge-curator preset | MetaPlatform-DSH-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| GraphRAG LLM 成本 | token meter + 预留 limit |
| 索引膨胀 | 定期归档 + 删除旧 chunk |
| 命中率不达标 | 评估迭代 + 人工标注反馈 |

## 10. 不做

- ❌ 自建 RAG（用 RAGFlow + GraphRAG）
- ❌ LightRAG（v3.0 抛弃）
- ❌ 多模态 embedding（v6.1 评估）

---

*PRD v1.0 — 配套 [MetaPlatform-RAG-01 Batch](../batch/MetaPlatform-RAG-01.md)*