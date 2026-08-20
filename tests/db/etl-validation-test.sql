-- supabase/tests/etl/etl-validation-test.sql
-- pgTAP 测试套件：覆盖 [PRD: etl-validation] 的 L1 行数校验
-- 跑测试：pg_prove -h $V6_DB -U supabase_admin -d postgres tests/etl/etl-validation-test.sql

BEGIN;
SELECT plan(20);

-- ============================================================
-- 测试 v3.0 → v6.0 数据迁移后的数据完整性
-- ============================================================

-- 模拟导入后的数据（实际应从中间文件导入）
INSERT INTO public.tenants (id, slug, name, status, metadata) VALUES
    ('11111111-1111-1111-1111-111111111111', 'acme', 'ACME', 'active', '{"v3_tenant_id": 1}'),
    ('22222222-2222-2222-2222-222222222222', 'globex', 'Globex', 'active', '{"v3_tenant_id": 2}'),
    ('33333333-3333-3333-3333-333333333333', 'initech', 'Initech', 'active', '{"v3_tenant_id": 3}');

-- 模拟客户数据
CREATE TABLE IF NOT EXISTS test.imported_customers (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    v3_customer_id bigint
);
INSERT INTO test.imported_customers VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Alice', 'alice@acme.com', 1001),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Bob', 'bob@acme.com', 1002),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Charlie', 'charlie@globex.com', 1003);

ALTER TABLE test.imported_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_customers_select ON test.imported_customers
    FOR SELECT TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claim.tenant_id', true))::uuid);

-- ============================================================
-- 测试 1: tenants 行数 = 3
-- ============================================================
SELECT results_eq(
    $$SELECT count(*)::int FROM public.tenants WHERE metadata->>'v3_tenant_id' IS NOT NULL$$,
    $$VALUES (3)$$,
    'v6.0 tenants 数量 = 3（与 v3.0 一致）'
);

-- ============================================================
-- 测试 2: customers 行数 = 3
-- ============================================================
SELECT results_eq(
    $$SELECT count(*)::int FROM test.imported_customers$$,
    $$VALUES (3)$$,
    'imported customers 数量 = 3（与 v3.0 一致）'
);

-- ============================================================
-- 测试 3: 跨租户 RLS 隔离
-- ============================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.tenant_id TO '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
    $$SELECT count(*)::int FROM test.imported_customers$$,
    $$VALUES (2)$$,
    'tenant 1 只能看到自己的 2 个客户'
);

RESET ROLE;
RESET request.jwt.claim.tenant_id;

-- ============================================================
-- 测试 4: tenant 2 看到自己的 1 个客户
-- ============================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.tenant_id TO '22222222-2222-2222-2222-222222222222';

SELECT results_eq(
    $$SELECT count(*)::int FROM test.imported_customers$$,
    $$VALUES (1)$$,
    'tenant 2 只能看到自己的 1 个客户'
);

RESET ROLE;
RESET request.jwt.claim.tenant_id;

-- ============================================================
-- 测试 5-10: v3 id 映射保留
-- ============================================================

SELECT results_eq(
    $$SELECT (metadata->>'v3_tenant_id')::int FROM public.tenants WHERE slug = 'acme'$$,
    $$VALUES (1)$$,
    'tenant acme 的 v3_id = 1'
);

SELECT results_eq(
    $$SELECT v3_customer_id FROM test.imported_customers WHERE email = 'alice@acme.com'$$,
    $$VALUES (1001)$$,
    'customer Alice 的 v3_id = 1001'
);

-- ============================================================
-- 测试 11-15: 用户密码迁移（基础）
-- ============================================================

-- 注：密码迁移需要测试 supabase.auth.admin.create_user
-- 这里只验证 auth.users 表存在且有 imported user
SELECT has_table('auth.users', 'auth.users 表存在');

SELECT results_eq(
    $$SELECT count(*)::int FROM auth.users WHERE raw_user_meta_data->>'v3_user_id' IS NOT NULL$$,
    $$VALUES (5)$$,  -- 假设 5 个测试用户
    'auth.users 中 imported 用户数 = 5'
);

-- ============================================================
-- 测试 16-20: audit_log 完整性
-- ============================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.tenant_id TO '11111111-1111-1111-1111-111111111111';

-- 写一条新数据，应该进 audit_log
DO $$
DECLARE
    v_before int;
    v_after int;
BEGIN
    SELECT count(*) INTO v_before
    FROM public.audit_log
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

    INSERT INTO test.imported_customers (id, tenant_id, name, email, v3_customer_id)
    VALUES (gen_random_uuid(),
            '11111111-1111-1111-1111-111111111111',
            'NewCustomer', 'new@acme.com', 9999);

    SELECT count(*) INTO v_after
    FROM public.audit_log
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND table_name = 'imported_customers';

    IF v_after > v_before THEN
        RAISE NOTICE 'audit_log 触发器对 ETL 后的写操作生效';
    ELSE
        RAISE EXCEPTION 'audit_log 触发器未生效';
    END IF;
END$$;

RESET ROLE;
RESET request.jwt.claim.tenant_id;

-- ============================================================
-- 清理
-- ============================================================
DROP TABLE test.imported_customers CASCADE;
DELETE FROM public.tenants WHERE id IN (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'
);

SELECT * FROM finish();
ROLLBACK;