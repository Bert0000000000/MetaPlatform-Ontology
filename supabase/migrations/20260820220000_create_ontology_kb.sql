-- supabase/migrations/20260820220000_create_ontology_kb.sql
-- PRD: docs/active/prd/mp-ontology-kb.md (Loop AD ontology 知识库)
-- ADR:  docs/active/decisions/ADR-0056-ontology-generation.md (ext)
-- 新表: public.ontology_kb (本体的 Markdown 知识文档)
-- 字段: id (uuid), tenant_id (uuid), title, content (markdown), tags (text[]),
--       rid (text, 关联 ontology_object_types/relation_types/action_types.rid),
--       status, created_at, updated_at
-- RLS: tenant-scoped (per M11 Kernel 模式)

CREATE TABLE IF NOT EXISTS public.ontology_kb (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    title text NOT NULL,
    content text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    rid text,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ontology_kb_tenant_idx ON public.ontology_kb (tenant_id);
CREATE INDEX IF NOT EXISTS ontology_kb_status_idx ON public.ontology_kb (tenant_id, status);
CREATE INDEX IF NOT EXISTS ontology_kb_rid_idx ON public.ontology_kb (tenant_id, rid);
CREATE INDEX IF NOT EXISTS ontology_kb_tags_idx ON public.ontology_kb USING GIN (tags);

ALTER TABLE public.ontology_kb ENABLE ROW LEVEL SECURITY;

-- tenant-scoped SELECT/INSERT/UPDATE/DELETE (复用 _policy_tenant_*)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_policy_tenant_select') THEN
        EXECUTE 'SELECT public._policy_tenant_select(''public.ontology_kb''::regclass)';
        EXECUTE 'SELECT public._policy_tenant_insert(''public.ontology_kb''::regclass)';
        EXECUTE 'SELECT public._policy_tenant_update(''public.ontology_kb''::regclass)';
        EXECUTE 'SELECT public._policy_tenant_delete(''public.ontology_kb''::regclass)';
    ELSE
        -- 兼容: 直接写 RLS policy
        EXECUTE 'CREATE POLICY ontology_kb_tenant_select ON public.ontology_kb FOR SELECT USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)';
        EXECUTE 'CREATE POLICY ontology_kb_tenant_insert ON public.ontology_kb FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)';
        EXECUTE 'CREATE POLICY ontology_kb_tenant_update ON public.ontology_kb FOR UPDATE USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)';
        EXECUTE 'CREATE POLICY ontology_kb_tenant_delete ON public.ontology_kb FOR DELETE USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)';
    END IF;
END $$;

-- 自动注入 tenant_id (复用 tg_inject_tenant trigger fn)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tg_inject_tenant_template') THEN
        EXECUTE 'CREATE TRIGGER tg_ontology_kb_inject_tenant BEFORE INSERT ON public.ontology_kb FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant()';
    END IF;
END $$;

-- 自动更新 updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
        EXECUTE 'CREATE TRIGGER tg_ontology_kb_updated_at BEFORE UPDATE ON public.ontology_kb FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at()';
    END IF;
END $$;

COMMENT ON TABLE public.ontology_kb IS 'Ontology 知识库: 本体的 Markdown 文档, 可关联 rid. 多租户 RLS.';
COMMENT ON COLUMN public.ontology_kb.rid IS '关联 ontology_object_types / relation_types / action_types 的 rid (nullable)';
COMMENT ON COLUMN public.ontology_kb.tags IS 'Markdown 标签 (用于过滤)';