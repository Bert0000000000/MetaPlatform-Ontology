-- supabase/policies/templates.sql
-- PRD: docs/active/prd/foundation-rls-policy.md §4.1-4.3
-- 这份文件是 RLS policy 模板参考 (供后续业务表 CREATE 时直接复用).
-- 业务表在各自的 supabase/migrations/*.sql 中调用 public._policy_* 函数,
-- 不需要重复 policy 文本. 这里只列每个 policy 模板的"模板".

-- ============================================================================
-- 模板 A: tenant 隔离 SELECT
-- ============================================================================
-- CREATE POLICY rls_<table>_tenant_select ON <schema>.<table>
--     FOR SELECT TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
--
-- 例 (orders 表):
-- CREATE POLICY rls_orders_tenant_select ON public.orders
--     FOR SELECT TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================================
-- 模板 B: tenant 隔离 INSERT (WITH CHECK 双重保证)
-- ============================================================================
-- CREATE POLICY rls_<table>_tenant_insert ON <schema>.<table>
--     FOR INSERT TO authenticated
--     WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
--
-- 配合触发器 public.tg_inject_tenant() 自动注入, 业务代码即使不填 tenant_id
-- 也能写入, 但 RLS WITH CHECK 保证最终值 == JWT.tenant_id.

-- ============================================================================
-- 模板 C: tenant 隔离 UPDATE
-- ============================================================================
-- CREATE POLICY rls_<table>_tenant_update ON <schema>.<table>
--     FOR UPDATE TO authenticated
--     USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
--     WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================================
-- 模板 D: tenant 隔离 DELETE (限定 owner / admin)
-- ============================================================================
-- CREATE POLICY rls_<table>_tenant_delete ON <schema>.<table>
--     FOR DELETE TO authenticated
--     USING (
--         tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
--         AND (auth.jwt() ->> 'role') IN ('owner', 'admin')
--     );

-- ============================================================================
-- 模板 E: service_role 全权 (隐式 — 不需要写 policy)
-- ============================================================================
-- Supabase Postgres 中 service_role 默认 BYPASSRLS = on.
-- 所以 service_role 自动绕过所有 RLS policy, 不需要额外声明.
-- 文档化记录在 evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md.

-- ============================================================================
-- 模板 F: anon 全部禁止 (用于业务表)
-- ============================================================================
-- v6.0 默认 anon 完全禁止读业务表 (除 auth 注册流程外).
-- 通过 "不创建 FOR anon 的 policy" 实现 (default deny).
-- 例: 注册时 anon 通过 Edge Function 调 service_role 写 profiles, anon 直接 SELECT 被 RLS 拒.

-- ============================================================================
-- 豁免规则 (_internal_* / _tmp_* / _cache_*)
-- ============================================================================
-- 系统表 / 缓存表如果需要豁免 RLS, 必须遵循:
-- 1. 表名以 _internal_ / _tmp_ / _cache_ 开头
-- 2. 表 COMMENT 标注 '[RLS-EXEMPT] 理由'
-- 3. 在 evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md 登记 + 双重签字 (架构师 + SRE Lead)
-- 4. ALTER TABLE ... DISABLE ROW LEVEL SECURITY 必须紧跟 CREATE TABLE
-- 5. CI gate scripts/ci/rls-check.sh 在 _internal_/_tmp_/_cache_ 表上豁免检测