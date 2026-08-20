-- supabase/migrations/20260820130600_create_departments.sql
-- 业务表: departments (P1, 与 employees 形成树形结构)

CREATE TABLE public.departments (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    name            text NOT NULL,
    code            text NOT NULL,
    parent_id       uuid REFERENCES public.departments(id),  -- 自引用, 形成树
    manager_id      uuid REFERENCES public.employees(id),
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'archived')),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, code)
);

CREATE INDEX departments_tenant_parent_idx ON public.departments (tenant_id, parent_id);
CREATE INDEX departments_tenant_status_idx ON public.departments (tenant_id, status);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.departments IS 'P1 业务表: departments (组织架构). 多租户 RLS + audit + 树形结构.';

SELECT public._policy_tenant_select('public.departments'::regclass);
SELECT public._policy_tenant_insert('public.departments'::regclass);
SELECT public._policy_tenant_update('public.departments'::regclass);
SELECT public._policy_tenant_delete('public.departments'::regclass);

CREATE TRIGGER tg_departments_inject_tenant
    BEFORE INSERT ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_departments_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- 现在补 employees.department_id 的 FK
ALTER TABLE public.employees
    ADD CONSTRAINT employees_department_fk
    FOREIGN KEY (department_id) REFERENCES public.departments(id);