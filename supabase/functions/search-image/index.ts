// supabase/functions/search-image/index.ts
// MP-V6.1 Multimodal RAG: text -> image search
// Accepts a CLIP text embedding, returns top-K similar images

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface SearchRequest {
  query_embedding: number[];
  limit?: number;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as SearchRequest;
    if (!body.query_embedding || body.query_embedding.length !== 512) {
      return new Response(JSON.stringify({ error: 'query_embedding must be 512-dim array' }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const limit = body.limit ?? 10;
    const embeddingStr = '[' + body.query_embedding.join(',') + ']';

    const { data, error } = await supabase.rpc('search_images_by_text', {
      p_query_embedding: embeddingStr,
      p_tenant_id: auth.tenantId,
      p_limit: limit,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({
      results: data ?? [],
      count: data?.length ?? 0,
      limit,
    }), { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
