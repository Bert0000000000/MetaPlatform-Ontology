// supabase/functions/embed-image/index.ts
// MP-V6.1 Multimodal RAG Phase 1: image embedding (CLIP mock)
// Per ADR-0065: real impl = FastAPI sidecar (CLIP-ViT-B/32)
// PoC: return 512-dim zero vector + image_hash for dedup

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface EmbedRequest {
  image_url: string;
  metadata?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can embed images', 403);
    }
    const body = await req.json() as EmbedRequest;
    if (!body.image_url) {
      return new Response(JSON.stringify({ error: 'image_url required' }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: hashData } = await supabase.rpc('image_url_hash', { p_url: body.image_url });
    const vector = new Array(512).fill(0);

    const { data, error } = await supabase
      .from('image_embeddings')
      .upsert({
        tenant_id: auth.tenantId,
        image_url: body.image_url,
        image_hash: hashData,
        embedding: JSON.stringify(vector),
        metadata: body.metadata ?? {},
      }, { onConflict: 'tenant_id,image_hash' })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({
      embedding_id: (data as { id: string }).id,
      image_url: (data as { image_url: string }).image_url,
      image_hash: (data as { image_hash: string }).image_hash,
      model: 'clip-vit-b32',
      dimensions: 512,
      note: 'PoC: zero vector (real impl = FastAPI sidecar with transformers)',
    }), { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
