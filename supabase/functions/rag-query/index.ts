// supabase/functions/rag-query/index.ts
// PRD: docs/active/prd/rag-dual-engine.md §4.3
// Batch: MP-V6-RAG-01
// 双路并行检索 + 融合 + dsh llm 生成答案

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface RagQueryRequest {
  query: string;
  top_k?: number;          // 默认 10
  preset_hints?: string[];
}

interface RagSource {
  type: 'ragflow' | 'graphrag';
  document_id: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

async function ragflowSearch(query: string, tenantId: string, topK: number): Promise<RagSource[]> {
  const baseUrl = Deno.env.get('RAGFLOW_BASE_URL') ?? 'http://ragflow.mp-ai.svc:9388';
  const apiKey = Deno.env.get('RAGFLOW_API_KEY');

  const resp = await fetch(`${baseUrl}/api/v1/retrieval/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      top_k: topK,
      retrieval_mode: 'hybrid',  // BM25 + 向量
      metadata_filter: { tenant_id: tenantId },  // 租户隔离
    }),
  });
  const data = await resp.json() as { chunks?: Array<{ document_id: string; content: string; score: number }> };

  return (data.chunks ?? []).map((c) => ({
    type: 'ragflow' as const,
    document_id: c.document_id,
    snippet: c.content,
    score: c.score,
  }));
}

async function graphragSearch(query: string, tenantId: string, topK: number): Promise<RagSource[]> {
  const baseUrl = Deno.env.get('GRAPHRAG_BASE_URL') ?? 'http://graphrag.mp-ai.svc:8080';

  const resp = await fetch(`${baseUrl}/query`,`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      top_k: topK,
      tenant_filter: tenantId,
    }),
  });
  const data = await resp.json() as { results?: Array<{ entity_id: string; summary: string; score: number }> };

  return (data.results ?? []).map((r) => ({
    type: 'graphrag' as const,
    document_id: r.entity_id,
    snippet: r.summary,
    score: r.score,
  }));
}

async function dshLlmGenerate(query: string, context: string): Promise<string> {
  // 调 dsh llm (DeepSeek primary via @mp/llm-client)
  // 简化 stub: 实际调 DeepSeek API
  return `[dsh generated answer] 基于 ${context.split('\n').length} 条引用, query="${query.slice(0, 30)}..."`;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as RagQueryRequest;

    if (!body.query) throw new Error('Missing query');

    const topK = body.top_k ?? 10;

    // 1. 双路并行检索
    const [ragflowResults, graphragResults] = await Promise.all([
      ragflowSearch(body.query, auth.tenantId, topK),
      graphragSearch(body.query, auth.tenantId, topK),
    ]);

    // 2. 融合 + 去重 + 排序
    const fused = [
      ...ragflowResults,
      ...graphragResults.map((s) => ({ ...s, score: s.score * 1.2 })),  // KG boost
    ].sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const deduped = fused.filter((s) => {
      if (seen.has(s.document_id)) return false;
      seen.add(s.document_id);
      return true;
    }).slice(0, topK);

    // 3. dsh llm 生成最终答案
    const context = deduped.map((s, i) => `[${i + 1}] (${s.type}, ${s.score.toFixed(2)}) ${s.snippet}`).join('\n\n');
    const answer = await dshLlmGenerate(body.query, context);

    // 4. Realtime broadcast (前端 knowledge-curator 接收)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await supabase.channel(`realtime:${auth.tenantId}`).send({
      type: 'broadcast',
      event: 'rag_query_completed',
      payload: { query: body.query, source_count: deduped.length },
    });

    return new Response(JSON.stringify({
      answer,
      sources: deduped,
      stats: {
        ragflow_count: ragflowResults.length,
        graphrag_count: graphragResults.length,
        fused_count: deduped.length,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});