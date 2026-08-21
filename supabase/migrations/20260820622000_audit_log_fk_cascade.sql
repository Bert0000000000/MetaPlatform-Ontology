-- supabase/migrations/20260820622000_audit_log_fk_cascade.sql
-- 移除 audit_log.tenant_id 的 FK 约束
--
-- 原因: ontology_* ON DELETE CASCADE 在 DELETE FROM tenants 时级联触发,
-- AFTER DELETE trigger tg_audit 在 audit_log 重新 INSERT 行, 此时被删除的
-- tenants 行在同一事务内"消失", IMMEDIATE/DEFERRED FK 均失败.
-- (DEFERRED 也失败因为 ON DELETE CASCADE 在 commit 前已先级联清理过 audit_log,
--  而 tg_audit 插入的新行在 cascade 之后才出现 — 顺序竞争)
--
-- audit_log 设计上就是 append-only / immutable, 不需要强 FK 约束. tenant_id
-- 列仍保留, 软关联到 public.tenants. 查询时用 LEFT JOIN. Tenant 删除后
-- 审计日志仍保留 tenant_id 值 (合规要求: 2 年保留).
--
-- Loop 1/3 → 2/3 → 3/3 of issue #15 已完成 (执行 trace 完全 green).

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey;
-- 兼容: 部分 partition 也可能有自己的约束名
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT conname FROM pg_constraint WHERE conname LIKE 'audit_log_tenant%' LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.conname, r.conname);
    END LOOP;
END $$;

COMMENT ON COLUMN public.audit_log.tenant_id IS
    'v6.0: 软关联到 public.tenants (无 FK 约束, 避免 cascade delete + AFTER trigger 顺序竞争).
    tenant 删除后 audit_log 行仍保留 (合规 2 年). 查询时 LEFT JOIN public.tenants ON id = tenant_id.';