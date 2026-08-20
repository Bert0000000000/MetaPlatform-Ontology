-- supabase/migrations/20260820300000_create_multimodal_rag.sql
-- PRD: docs/active/decisions/ADR-0065-v6.1-multimodal-rag.md
-- Batch: MetaPlatform.1-MULTIMODAL-RAG-01 (PoC Phase 1: image embedding)

-- 1) image_embeddings table (CLIP 512-dim vectors)
CREATE TABLE IF NOT EXISTS public.image_embeddings (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    image_url       text NOT NULL,
    image_hash      text NOT NULL,
    embedding       vector(512),
    model           text NOT NULL DEFAULT 'clip-vit-b32',
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_embeddings_tenant_idx
    ON public.image_embeddings (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS image_embeddings_hash_idx
    ON public.image_embeddings (tenant_id, image_hash);
CREATE INDEX IF NOT EXISTS image_embeddings_vector_idx
    ON public.image_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.image_embeddings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.image_embeddings IS 'v6.1 Multimodal RAG: image embeddings (CLIP-ViT-B/32, 512-dim). RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.image_embeddings'::regclass);
SELECT public._policy_tenant_insert('public.image_embeddings'::regclass);
SELECT public._policy_tenant_update('public.image_embeddings'::regclass);
SELECT public._policy_tenant_delete('public.image_embeddings'::regclass);

CREATE TRIGGER tg_image_embeddings_inject_tenant
    BEFORE INSERT ON public.image_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_image_embeddings_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.image_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- 2) image_search RPC
CREATE OR REPLACE FUNCTION public.search_images_by_text(
    p_query_embedding vector(512),
    p_tenant_id uuid,
    p_limit int DEFAULT 10
) RETURNS TABLE(
    id uuid,
    image_url text,
    metadata jsonb,
    similarity float
) LANGUAGE sql STABLE AS $$
    SELECT
        ie.id,
        ie.image_url,
        ie.metadata,
        1 - (ie.embedding <=> p_query_embedding) AS similarity
    FROM public.image_embeddings ie
    WHERE ie.tenant_id = p_tenant_id
    ORDER BY ie.embedding <=> p_query_embedding
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_images_by_text(vector, uuid, int) TO anon, authenticated, service_role;

-- 3) image_url_hash
CREATE OR REPLACE FUNCTION public.image_url_hash(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(digest(p_url, 'sha256'), 'hex');
$$;
