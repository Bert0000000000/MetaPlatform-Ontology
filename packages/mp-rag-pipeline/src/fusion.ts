/**
 * packages/mp-rag-pipeline/src/fusion.ts
 * PRD: docs/active/prd/rag-dual-engine.md §4.3
 * Batch: MetaPlatform-RAG-01
 *
 * RAGFlow + GraphRAG 双路融合
 */

export interface RagSource {
  type: 'ragflow' | 'graphrag';
  documentId: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RagResult {
  sources: RagSource[];
  fusedAnswer: string;
}

export interface RagQueryOptions {
  query: string;
  tenantId: string;
  topK?: number;
}

/**
 * 合并 RAGFlow (文档级) + GraphRAG (KG 实体级) 结果
 * 排序策略: type boost (graphrag ×1.2 权重, 因为 KG 通常更精准)
 */
export function fuseRagResults(
  ragflow: RagSource[],
  graphrag: RagSource[],
  limit: number = 10,
): RagSource[] {
  const merged: RagSource[] = [
    ...ragflow.map((s) => ({ ...s, score: s.score })),
    ...graphrag.map((s) => ({ ...s, score: s.score * 1.2 })),  // graphrag 权重 boost
  ];

  // 按 score 降序
  merged.sort((a, b) => b.score - a.score);

  // 去重 (同 documentId 保留最高分)
  const seen = new Map<string, RagSource>();
  for (const s of merged) {
    const existing = seen.get(s.documentId);
    if (!existing || existing.score < s.score) {
      seen.set(s.documentId, s);
    }
  }

  return Array.from(seen.values()).slice(0, limit);
}

export function buildRagContext(sources: RagSource[]): string {
  return sources
    .map((s, i) => `[${i + 1}] (${s.type}, score ${s.score.toFixed(3)}) ${s.snippet}`)
    .join('\n\n');
}