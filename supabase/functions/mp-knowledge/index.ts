// supabase/functions/mp-knowledge/index.ts
// PRD: docs/active/prd/mp-knowledge.md (编排层, Issue #15 PoC)
// PoC scope:
//   query rewrite -> L1 cache -> call rag-query EF -> rerank -> RAGAS-like eval
// Full implementation tracked in GH issue #15.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface MpKnowledgeRequest {
  query: string;
  top_k?: number;             // default 5
  mode?: 'hybrid' | 'semantic' | 'keyword';  // default hybrid
}

interface MpKnowledgeResult {
  id: string;
  content: string;
  score: number;
  source: 'ragflow' | 'graphrag' | 'cache';
}

interface MpKnowledgeResponse {
  query: string;
  mode: string;
  results: MpKnowledgeResult[];
  quality_score: number;       // RAGAS-like, 0..1
  cache_hit: boolean;
  degraded: boolean;           // true if rag-query upstream was unreachable
  stats: {
    candidates: number;
    rerank_ms: number;
    total_ms: number;
  };
}

// ----- L1 in-memory cache (per isolate, TTL-bounded) -----
interface CacheEntry {
  ts: number;
  payload: MpKnowledgeResponse;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;   // 60s
const CACHE_MAX = 1000;

function cacheGet(key: string): MpKnowledgeResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key: string, payload: MpKnowledgeResponse): void {
  if (cache.size >= CACHE_MAX) {
    // evict oldest insertion
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), payload });
}

// ----- query rewrite (PoC: lowercase + collapse whitespace) -----
function rewriteQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ----- simple rerank: combine upstream score with BM25-style keyword hit ratio -----
function rerank<T extends { content: string; score: number }>(query: string, items: T[]): T[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  const tokenSet = new Set(tokens);
  return items
    .map((it) => {
      const text = (it.content ?? '').toLowerCase();
      let hits = 0;
      for (const t of tokenSet) if (text.includes(t)) hits++;
      const bm25 = hits / tokens.length;
      return { ...it, score: 0.7 * (it.score ?? 0) + 0.3 * bm25 };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ----- RAGAS-like quality stub (PoC; no real RAGAS lib) -----
// Composite of avg score, content diversity, query-context ratio.
function ragasLikeEval(query: string, results: MpKnowledgeResult[]): number {
  if (results.length === 0) return 0;
  const avg = results.reduce((a, r) => a + r.score, 0) / results.length;
  const diversity = new Set(results.map((r) => r.content.slice(0, 64))).size / results.length;
  const lenRatio = Math.min(1, query.length / 30);
  return Math.min(1, 0.5 * avg + 0.3 * diversity + 0.2 * lenRatio);
}

// ----- call rag-query EF (PoC; gracefully degrades on upstream failure) -----
async function callRagQuery(
  supabase: ReturnType<typeof createClient>,
  query: string,
  topK: number,
): Promise<{ sources: any[]; degraded: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('rag-query', {
      body: { query, top_k: topK },
    });
    if (error) return { sources: [], degraded: true, error: error.message };
    return { sources: data?.sources ?? [], degraded: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { sources: [], degraded: true, error: message };
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const t0 = performance.now();

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as MpKnowledgeRequest;

    // validation
    if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'missing_query', message: 'query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (body.top_k !== undefined && (typeof body.top_k !== 'number' || body.top_k < 1 || body.top_k > 50)) {
      return new Response(
        JSON.stringify({ error: 'invalid_top_k', message: 'top_k must be 1..50' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (body.mode !== undefined && !['hybrid', 'semantic', 'keyword'].includes(body.mode)) {
      return new Response(
        JSON.stringify({ error: 'invalid_mode', message: 'mode must be hybrid|semantic|keyword' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const topK = body.top_k ?? 5;
    const mode = body.mode ?? 'hybrid';
    const rewritten = rewriteQuery(body.query);

    // L1 cache (per tenant+mode+top_k+query)
    const cacheKey = `${auth.tenantId}:${mode}:${topK}:${rewritten}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify({ ...cached, cache_hit: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // forward user JWT so rag-query sees RLS-correct tenant context
    const userAuthHeader = req.headers.get('authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: userAuthHeader } } },
    );

    // pull 2x candidates so rerank can down-select
    const upstream = await callRagQuery(supabase, rewritten, topK * 2);

    const candidates: MpKnowledgeResult[] = upstream.sources.map((s: any) => ({
      id: String(s.document_id ?? ''),
      content: String(s.snippet ?? ''),
      score: Number(s.score ?? 0),
      source: s.type === 'graphrag' ? 'graphrag' : 'ragflow',
    }));

    const tr0 = performance.now();
    const reranked = rerank(rewritten, candidates).slice(0, topK);
    const rerankMs = performance.now() - tr0;

    const quality = ragasLikeEval(rewritten, reranked);

    const payload: MpKnowledgeResponse = {
      query: rewritten,
      mode,
      results: reranked,
      quality_score: Number(quality.toFixed(3)),
      cache_hit: false,
      degraded: upstream.degraded,
      stats: {
        candidates: candidates.length,
        rerank_ms: Math.round(rerankMs),
        total_ms: Math.round(performance.now() - t0),
      },
    };

    // only cache healthy responses (degraded → don't poison cache)
    if (!upstream.degraded) {
      cacheSet(cacheKey, payload);
    }

    return new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: 'internal', message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});