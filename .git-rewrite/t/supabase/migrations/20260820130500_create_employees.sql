-- supabase/migrations/20260820130500_create_employees.sql
-- 业务表: employees (P1, 与 auth.users 关联但 1:1 可选)

CREATE TABLE public.employees (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    user_id         uuid REFERENCES auth.users(id),  -- 可选: 员工也可能没账号
    employee_number text NOT NULL,
    full_name       text NOT NULL,
    department_id   uuid,                             -- → public.departments.id (见后续 migration)
    manager_id      uuid REFERENCES public.employees(id),
    title           text,
    hire_date       date,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_leave', 'terminated')),
    contact_email   text,
    contact_phone   text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (tenant_id, employee_number)
);

CREATE INDEX employees_tenant_status_idx ON public.employees (tenant_id, status);
CREATE INDEX employees_tenant_dept_idx ON public.employees (tenant_id, department_id);
CREATE INDEX employees_manager_idx ON public.employees (manager_id) WHERE manager_id IS NOT NULL;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.employees IS 'P1 业务表: employees (HR). 多租户 RLS + audit + 软删.';

SELECT public._policy_tenant_select('public.employees'::regclass);
SELECT public._policy_tenant_insert('public.employees'::regclass);
SELECT public._policy_tenant_update('public.employees'::regclass);
SELECT public._policy_tenant_delete('public.employees'::regclass);

CREATE TRIGGER tg_employees_inject_tenant
    BEFORE INSERT ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_employees_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();