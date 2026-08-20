-- supabase/migrations/20260820120300_create_audit_log.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.2.3
-- 审计日志: 保留 2 年 (合规要求); 超过归档到冷存储 (见 foundation-dr-backup.md)

CREATE TABLE public.audit_log (
    id           bigserial,
    tenant_id    uuid REFERENCES public.tenants(id),
    actor_id     uuid REFERENCES auth.users(id),  -- system 操作为 NULL
    action       text NOT NULL,                    -- INSERT / UPDATE / DELETE / LOGIN / EXPORT
    schema_name  text NOT NULL,
    table_name   text NOT NULL,
    row_pk       jsonb,
    old_values   jsonb,
    new_values   jsonb,
    ip_addr      inet,
    user_agent   text,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 当月分区
CREATE TABLE public.audit_log_default PARTITION OF public.audit_log DEFAULT;

CREATE INDEX audit_log_tenant_idx ON public.audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx  ON public.audit_log (actor_id, occurred_at DESC);
CREATE INDEX audit_log_table_idx  ON public.audit_log (schema_name, table_name, occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audit_log IS 'Mandatory audit log. RLS: tenant isolation. 保留 2 年, 超期归档冷存储 (foundation-dr-backup.md).';

CREATE POLICY audit_log_tenant_select ON public.audit_log
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- INSERT/UPDATE/DELETE: 仅 service_role (触发器内部写入用 SECURITY DEFINER 函数)