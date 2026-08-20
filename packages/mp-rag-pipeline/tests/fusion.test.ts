/**
 * packages/mp-rag-pipeline/tests/fusion.test.ts
 *
 * Verifies RAG result fusion logic (dedup + sort + KG boost).
 */

import { describe, it, expect } from 'vitest';
import { fuseRagResults, buildRagContext, type RagSource } from '../src/fusion.js';

describe('fuseRagResults', () => {
  it('combines ragflow + graphrag with graphrag weight boost', () => {
    const ragflow: RagSource[] = [
      { type: 'ragflow', documentId: 'doc-1', snippet: 'chunk A', score: 0.8 },
      { type: 'ragflow', documentId: 'doc-2', snippet: 'chunk B', score: 0.6 },
    ];
    const graphrag: RagSource[] = [
      { type: 'graphrag', documentId: 'entity-X',', snippet: 'KG about X',', score: 0.7 },
    ];

    const fused = fuseRagResults(ragflow, graphrag);

    expect(fused).toHaveLength(3);
    // doc-1 (0.8) > entity-X (0.84 = 0.7 * 1.2) > doc-2 (0.6)
    expect(fused[0]?.documentId).toBe('entity-X');  // KG boost 0.84 > 0.8
    expect(fused[1]?.documentId).toBe('doc-1');
    expect(fused[2]?.documentId).toBe('doc-2');
  });

  it('dedupes by documentId, keeping highest score', () => {
    const ragflow: RagSource[] = [
      { type: 'ragflow', documentId: 'shared', snippet: 'low', score: 0.5 },
    ];
    const graphrag: RagSource[] = [
      { type: 'graphrag', documentId: 'shared', snippet: 'high', score: 0.9 },
    ];

    const fused = fuseRagResults(ragflow, graphrag);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.snippet).toBe('high');
    expect(fused[0]?.type).toBe('graphrag');
  });

  it('respects limit', () => {
    const ragflow: RagSource[] = Array.from({ length: 15 }, (_, i) => ({
      type: 'ragflow' as const,
      documentId: `doc-${i}`,
      snippet: `chunk ${i}`,
      score: 1 - i * 0.05,
    }));

    const fused = fuseRagResults(ragflow, [], 5);
    expect(fused).toHaveLength(5);
  });
});

describe('buildRagContext', () => {
  it('formats sources with index + type + score + snippet', () => {
    const sources: RagSource[] = [
      { type: 'ragflow', documentId: 'doc-1', snippet: 'A', score: 0.9 },
      { type: 'graphrag', documentId: 'entity-X',', snippet: 'B', score: 0.7 },
    ];

    const ctx = buildRagContext(sources);
    expect(ctx).toContain('[1] (ragflow, score 0.900) A');
    expect(ctx).toContain('[2] (graphrag, score 0.700) B');
  });
});