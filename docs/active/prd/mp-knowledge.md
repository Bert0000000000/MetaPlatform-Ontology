# PRD：mp-knowledge（GraphRAG）

> **应用**：mp-knowledge — GraphRAG 知识库引擎
> **类别**：2. AI 能力
> **对应 namespace**：mp-ai
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-knowledge` 是 v6.0 的**RAG 双引擎**（决策 #10，见 [architecture spec §1](../specs/2026-08-19-mp-v6-architecture.md)）：**RAGFlow + Microsoft GraphRAG** 并存：

- **RAGFlow**：文档解析 + embedding + BM25 + 向量检索
- **Microsoft GraphRAG**：知识图谱 + Leiden 社区 + 全局摘要

业务应用通过统一 API 调用，按场景自动选择引擎。

## 2. 核心功能

- 文档上传（PDF / Word / Markdown / HTML）
- 自动文档解析（OCR + 段落切分）
- Embedding 生成（DeepSeek / OpenAI）
- 向量索引（pgvector）
- BM25 全文索引
- 知识图谱构建（实体识别 + 关系抽取）
- Leiden 社区检测 + 全局摘要
- 混合检索（向量 + BM25 + KG）
- 多租户隔离（每租户独立知识库）

## 3. 关键接口

```typescript
// 上传文档
POST /v1/documents
{ "file": ..., "knowledge_base_id": "...", "metadata": {...} }

// 检索
POST /v1/search
{
  "knowledge_base_id": "...",
  "query": "...",
  "mode": "hybrid",                // vector / bm25 / kg / hybrid
  "top_k": 10,
  "filters": {...}
}

// 问答（基于检索的生成）
POST /v1/qa
{ "knowledge_base_id": "...", "question": "...", "stream": true }
```

## 4. 数据模型

```sql
CREATE TABLE mp_knowledge.knowledge_bases (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
    name         text NOT NULL,
    description  text,
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {engine: 'ragflow' | 'graphrag' | 'hybrid'}
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_knowledge.documents (
    id           uuid PRIMARY KEY,
    kb_id        uuid NOT NULL REFERENCES mp_knowledge.knowledge_bases(id),
    tenant_id    uuid NOT NULL,
    title        text NOT NULL,
    source_uri   text,                              -- 原始 URL / 文件路径
    mime_type    text,
    size_bytes   bigint,
    status       text NOT NULL DEFAULT 'pending',  -- pending / parsing / indexing / ready / failed
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mp_knowledge.chunks (
    id           uuid PRIMARY KEY,
    document_id  uuid NOT NULL REFERENCES mp_knowledge.documents(id),
    tenant_id    uuid NOT NULL,
    content      text NOT NULL,
    embedding    vector(1536),                      -- pgvector
    chunk_index  int NOT NULL,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX chunks_embedding_idx ON mp_knowledge.chunks USING hnsw (embedding vector_cosine_ops);

-- GraphRAG 专属：实体 + 关系 + 社区
CREATE TABLE mp_knowledge.entities (...);
CREATE TABLE mp_knowledge.relations (...);
CREATE TABLE mp_knowledge.communities (...);

ALTER TABLE mp_knowledge.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/knowledge:v6.0.0-<sha>`
- 副本：HPA 2-10
- 资源：CPU 2 / Memory 4Gi（embedding 任务重）
- 入口：`api.mp-platform.local/knowledge/v1`
- 外部依赖：RAGFlow（独立服务）+ GraphRAG（Python 服务）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 上传 PDF 自动解析 + 切分 + embedding |
| AC2 | 向量检索 p95 < 500ms |
| AC3 | BM25 全文检索支持中文 |
| AC4 | GraphRAG 实体抽取 + 关系抽取 |
| AC5 | Leiden 社区检测跑通 |
| AC6 | 混合检索（vector + BM25 + KG）召回率 > 单一模式 |
| AC7 | 多租户隔离（tenant A 不能检索 tenant B 知识库）|
| AC8 | 问答（QA）streaming 输出 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| pgvector | MP-V6-FOUNDATION-01 |
| DeepSeek embedding | [mp-ai](mp-ai.md) |
| RAGFlow（外部服务）| 用户部署 |
| Microsoft GraphRAG（外部）| 用户部署 |

## 8. 不做

- ❌ 自研文档解析（用 RAGFlow）
- ❌ 自研知识图谱算法（用 GraphRAG）
- ❌ 多模态（图像 / 视频）：v6.1 引入
- ❌ LightRAG（决策 #10 抛弃）

---

*PRD v1.0 — 配套 [mp-ai](mp-ai.md) / [mp-ontology](mp-ontology.md) / [foundation-supabase-schema](foundation-supabase-schema.md)*