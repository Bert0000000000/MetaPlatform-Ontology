// supabase/functions/embed-video/index.ts
// MP-V6.1 Multimodal RAG Phase 2: video keyframe embedding (BLIP-2 mock)
// Per ADR-0065: real impl = FastAPI sidecar (BLIP-2 frame-by-frame)
// PoC: extract N keyframes at `fps` (default 1), insert each frame as:
//   1) image_embeddings row (Phase 1 reuse — CLIP-ViT-B/32 512-dim zero vector)
//   2) video_embeddings row (Phase 2 — BLIP-2 512-dim zero vector, FK -> image_embeddings.id)
// Returns { video_id, keyframe_count, video_duration_sec, frames: [{ frame_index, frame_timestamp_sec, embedding_id, image_embedding_id }] }

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface EmbedVideoRequest {
  video_url: string;
  fps?: number;
  video_duration_sec?: number; // optional override (PoC default = 10s)
  metadata?: Record<string, unknown>;
}

interface FrameResult {
  frame_index: number;
  frame_timestamp_sec: number;
  embedding_id: string;
  image_embedding_id: string;
}

const DEFAULT_DURATION_SEC = 10;
const DEFAULT_FPS = 1;
const MAX_FRAMES = 32; // PoC safety cap (BLIP-2 GPU cost)

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only admin/owner can embed videos', 403);
    }

    const body = await req.json() as EmbedVideoRequest;
    if (!body.video_url || typeof body.video_url !== 'string') {
      return new Response(JSON.stringify({ error: 'video_url required' }), { status: 400 });
    }

    const fps = Math.max(0.1, Math.min(body.fps ?? DEFAULT_FPS, 4));
    const durationSec = body.video_duration_sec ?? DEFAULT_DURATION_SEC;
    let keyframeCount = Math.min(Math.max(1, Math.floor(durationSec * fps)), MAX_FRAMES);
    // ensure we always produce at least 1 frame
    if (!Number.isFinite(keyframeCount) || keyframeCount < 1) keyframeCount = 1;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) compute deterministic video_hash for dedup
    const { data: videoHash, error: hashErr } = await supabase.rpc('video_url_hash', { p_url: body.video_url });
    if (hashErr) {
      return new Response(JSON.stringify({ error: 'hash failed: ' + hashErr.message }), { status: 500 });
    }

    const zeroVector = new Array(512).fill(0);
    const vectorLiteral = '[' + zeroVector.join(',') + ']';

    // 2) insert per keyframe: image_embeddings first (Phase 1 reuse), then video_embeddings with FK
    const frames: FrameResult[] = [];
    for (let i = 0; i < keyframeCount; i++) {
      const frameTimestamp = Number((i / fps).toFixed(3));

      // Phase 1: image_embeddings row
      const { data: imgRow, error: imgErr } = await supabase.rpc('insert_image_embedding', {
        p_tenant_id: auth.tenantId,
        p_image_url: body.video_url + '#frame=' + i,
        p_image_hash: videoHash + '-f' + i,
        p_embedding: vectorLiteral,
        p_metadata: { ...(body.metadata ?? {}), source: 'video', frame_index: i, video_hash: videoHash },
      });
      if (imgErr) {
        return new Response(JSON.stringify({ error: 'image insert failed (frame ' + i + '): ' + imgErr.message }), { status: 500 });
      }
      const img = Array.isArray(imgRow) ? imgRow[0] : imgRow;

      // Phase 2: video_embeddings row linked to image_embeddings
      const { data: vidRow, error: vidErr } = await supabase.rpc('insert_video_embedding', {
        p_tenant_id: auth.tenantId,
        p_video_url: body.video_url,
        p_video_hash: videoHash,
        p_video_duration_sec: durationSec,
        p_keyframe_count: keyframeCount,
        p_image_embedding_id: img.id,
        p_frame_index: i,
        p_frame_timestamp_sec: frameTimestamp,
        p_embedding: vectorLiteral,
        p_metadata: { ...(body.metadata ?? {}), frame_index: i },
      });
      if (vidErr) {
        return new Response(JSON.stringify({ error: 'video insert failed (frame ' + i + '): ' + vidErr.message }), { status: 500 });
      }
      const vid = Array.isArray(vidRow) ? vidRow[0] : vidRow;

      frames.push({
        frame_index: i,
        frame_timestamp_sec: frameTimestamp,
        embedding_id: vid.id,
        image_embedding_id: img.id,
      });
    }

    return new Response(JSON.stringify({
      video_id: videoHash,
      video_url: body.video_url,
      video_hash: videoHash,
      video_duration_sec: durationSec,
      keyframe_count: keyframeCount,
      fps,
      model: 'blip-2',
      dimensions: 512,
      frames,
      note: 'PoC: zero vector per frame (real impl = FastAPI sidecar with BLIP-2)',
    }), { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});