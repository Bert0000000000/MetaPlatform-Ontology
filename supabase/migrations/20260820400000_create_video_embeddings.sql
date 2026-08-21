-- supabase/migrations/20260820400000_create_video_embeddings.sql
-- PRD: docs/active/decisions/ADR-0065-v6.1-multimodal-rag.md
-- Batch: MetaPlatform.1-MULTIMODAL-RAG-02 (PoC Phase 2: video embedding via BLIP-2 frame-by-frame)
-- Phase 2: video_embeddings (linked keyframes) + insert_video_embedding RPC + search_video_frames RPC
-- IMPORTANT: do not modify image_embeddings (Phase 1). Phase 2 reuses image_embeddings for per-frame rows.

-- 1) video_embeddings table (BLIP-2 512-dim per keyframe, linked back to image_embeddings)
CREATE TABLE IF NOT EXISTS public.video_embeddings (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             uuid NOT NULL REFERENCES public.tenants(id),
    video_url             text NOT NULL,
    video_hash            text NOT NULL,
    video_duration_sec    numeric(10,3),
    keyframe_count        int NOT NULL DEFAULT 0,
    image_embedding_id    uuid REFERENCES public.image_embeddings(id) ON DELETE SET NULL,
    frame_index           int NOT NULL,
    frame_timestamp_sec   numeric(10,3) NOT NULL DEFAULT 0,
    embedding             vector(512),
    model                 text NOT NULL DEFAULT 'blip-2',
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, video_hash, frame_index)
);

CREATE INDEX IF NOT EXISTS video_embeddings_tenant_idx
    ON public.video_embeddings (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_embeddings_video_idx
    ON public.video_embeddings (tenant_id, video_hash, frame_index);
CREATE INDEX IF NOT EXISTS video_embeddings_image_idx
    ON public.video_embeddings (image_embedding_id);
CREATE INDEX IF NOT EXISTS video_embeddings_vector_idx
    ON public.video_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.video_embeddings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.video_embeddings IS 'v6.1 Multimodal RAG Phase 2: video keyframe embeddings (BLIP-2 512-dim). Linked to image_embeddings via image_embedding_id. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.video_embeddings'::regclass);
SELECT public._policy_tenant_insert('public.video_embeddings'::regclass);
SELECT public._policy_tenant_update('public.video_embeddings'::regclass);
SELECT public._policy_tenant_delete('public.video_embeddings'::regclass);

CREATE TRIGGER tg_video_embeddings_inject_tenant
    BEFORE INSERT ON public.video_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_video_embeddings_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.video_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- 2) video_url_hash (mirrors image_url_hash)
CREATE OR REPLACE FUNCTION public.video_url_hash(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(digest(p_url, 'sha256'), 'hex');
$$;

-- 3) insert_video_embedding RPC (vector type; matches insert_image_embedding pattern)
-- IMPORTANT: p_embedding is vector type (not text + ::vector cast), because pgvector lives in 'extensions'
-- schema and `SET search_path` here does NOT include it. Cast would fail with "type vector does not exist".
CREATE OR REPLACE FUNCTION public.insert_video_embedding(
    p_tenant_id uuid,
    p_video_url text,
    p_video_hash text,
    p_video_duration_sec numeric,
    p_keyframe_count int,
    p_image_embedding_id uuid,
    p_frame_index int,
    p_frame_timestamp_sec numeric,
    p_embedding vector,
    p_metadata jsonb
) RETURNS public.video_embeddings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, mp_preset_registry
AS $func$ DECLARE v_row public.video_embeddings;
BEGIN
    INSERT INTO public.video_embeddings (
        tenant_id, video_url, video_hash, video_duration_sec, keyframe_count,
        image_embedding_id, frame_index, frame_timestamp_sec, embedding, metadata
    ) VALUES (
        p_tenant_id, p_video_url, p_video_hash, p_video_duration_sec, p_keyframe_count,
        p_image_embedding_id, p_frame_index, p_frame_timestamp_sec, p_embedding, p_metadata
    )
    ON CONFLICT (tenant_id, video_hash, frame_index) DO UPDATE
        SET video_duration_sec = EXCLUDED.video_duration_sec,
            keyframe_count = EXCLUDED.keyframe_count,
            image_embedding_id = EXCLUDED.image_embedding_id,
            frame_timestamp_sec = EXCLUDED.frame_timestamp_sec,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
    RETURNING * INTO v_row;
    RETURN v_row;
END; $func$;

GRANT EXECUTE ON FUNCTION public.insert_video_embedding(
    uuid, text, text, numeric, int, uuid, int, numeric, vector, jsonb
) TO anon, authenticated, service_role;

-- 4) search_video_frames RPC: search across video keyframes (by query embedding)
CREATE OR REPLACE FUNCTION public.search_video_frames(
    p_query_embedding vector(512),
    p_tenant_id uuid,
    p_limit int DEFAULT 10
) RETURNS TABLE(
    id uuid,
    video_url text,
    video_hash text,
    image_embedding_id uuid,
    frame_index int,
    frame_timestamp_sec numeric,
    similarity float
) LANGUAGE sql STABLE AS $$
    SELECT
        ve.id,
        ve.video_url,
        ve.video_hash,
        ve.image_embedding_id,
        ve.frame_index,
        ve.frame_timestamp_sec,
        1 - (ve.embedding <=> p_query_embedding) AS similarity
    FROM public.video_embeddings ve
    WHERE ve.tenant_id = p_tenant_id
    ORDER BY ve.embedding <=> p_query_embedding
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_video_frames(vector, uuid, int) TO anon, authenticated, service_role;