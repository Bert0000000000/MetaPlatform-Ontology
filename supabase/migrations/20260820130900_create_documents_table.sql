-- supabase/migrations/20260820130900_create_documents_table.sql
-- 业务表: documents (P2, 与 RAG / Storage 关联)

CREATE TABLE public.documents (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    title           text NOT NULL,
    description     text,
    file_path       text NOT NULL,                   -- Supabase Storage path
    file_size       bigint,
    mime_type       text,
    category        text,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'archived')),
    -- RAG 集成: GraphRAG / RAGFlow 抽取后的 entity / chunk
    graphrag_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
    ragflow_chunks    jsonb NOT NULL DEFAULT '[]'::jsonb,
    embedding_model   text,                          -- e.g. 'text-embedding-3-small'
    embedded_at       timestamptz,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid REFERENCES auth.users(id),
    updated_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX documents_tenant_status_idx ON public.documents (tenant_id, status, created_at DESC);
CREATE INDEX documents_tenant_category_idx ON public.documents (tenant_id, category);
CREATE INDEX documents_metadata_idx ON public.documents USING gin (metadata);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.documents IS 'P2 业务表: documents (RAG 输入). 多租户 RLS + audit. embedding 字段给 RAG 集成.';

SELECT public._policy_tenant_select('public.documents'::regclass);
SELECT public._policy_tenant_insert('public.documents'::regclass);
SELECT public._policy_tenant_update('public.documents'::regclass);
SELECT public._policy_tenant_delete('public.documents'::regclass);

CREATE TRIGGER tg_documents_inject_tenant
    BEFORE INSERT ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_documents_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();