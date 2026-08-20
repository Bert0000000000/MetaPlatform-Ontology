-- supabase/migrations/20260820600000_grants_for_ef_writes.sql
-- Batch: MP-V6-EDGE-FN-01
-- Fix: Edge Functions 用 SUPABASE_SERVICE_ROLE_KEY 建 client, PostgREST 收到该 JWT 后
--      会 `SET ROLE service_role`. 但 service_role 在 public schema 的业务表上
--      **一条 table 权限都没有** (post-restore-fixes.sql L8 只 GRANT 给 anon/authenticated),
--      于是任何写操作直接被 PG 拒绝:
--          42501 permission denied for table customers
--          42501 permission denied for table hitl_requests
--      表现为 create-customer / ticket-triage Edge Function 返回 500.
--
--      注意: service_role 是 BYPASSRLS 的, 所以缺的**只是** table-level GRANT,
--      RLS policy 本身不需要改动 —— 本 migration 不放松任何租户隔离语义.
--
--      authenticator 是 PostgREST 的 login role, 正常路径下它会 SET ROLE 到
--      anon/authenticated/service_role, 因此并不直接需要表权限; 这里一并 GRANT
--      是为了兜底 (例如 PostgREST 在 role switch 之前/失败时的探测查询).
--
-- Idempotent: GRANT 可重复执行; supabase restart / db reset 后由
--             scripts/deploy/setup-preset.mjs 自动重放.

-- ---------------------------------------------------------------------------
-- 1) schema 级 USAGE (没有 USAGE 则表权限无从谈起)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- 1b) 应用角色 -> 真实 PG role
--     custom_access_token_hook 会把 profiles.role ('owner'/'admin'/'member'/'guest')
--     写进 JWT 的 `role` claim (见 20260820150000). 但 `role` 同时是 PostgREST
--     用来决定 `SET ROLE` 的保留 claim, 于是任何用户 JWT 直接打 /rest/v1/* 都会拿到:
--         401 {"code":"22023","message":"role \"admin\" does not exist"}
--     这正是 supabase-auth "create-customer in tenant A only visible to A" 里
--     userB 列 customers 时拿到 error object 而不是数组的原因.
--
--     修法: 把这四个应用角色建成真实 PG role, 并且
--       - INHERIT authenticated  -> 继承表权限, 且 `TO authenticated` 的 RLS policy
--                                   依然命中 (RLS 的 TO 走 pg_has_role(...,'USAGE'))
--       - GRANT ... TO authenticator -> PostgREST 才有权 SET ROLE 过去
--     这样既不动 hook, 也不动任何 RLS policy, 租户隔离语义完全不变;
--     auth.jwt() ->> 'role' IN ('owner','admin') 之类的判断也照旧生效.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'member', 'guest'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            -- INHERIT 是必须的: 没有它就拿不到 authenticated 的表权限和 RLS policy
            EXECUTE format('CREATE ROLE %I NOLOGIN INHERIT', v_role);
        END IF;
        EXECUTE format('GRANT authenticated TO %I', v_role);
        EXECUTE format('GRANT %I TO authenticator', v_role);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 业务表显式 DML GRANT (Edge Function 直接读写的表)
--    显式列出, 便于 review 时一眼看清"哪些表被 EF 写".
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers           TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hitl_requests       TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log           TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets             TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dsh_session_headers TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts           TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products            TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices            TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications       TO service_role, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders              TO service_role, authenticator;

-- ---------------------------------------------------------------------------
-- 3) 全 schema 兜底 (上面漏掉的表 / 后续新增的表)
--    stock Supabase 本来就是这个语义: public 下所有表对四个 API role 开放,
--    真正的隔离由 RLS policy 承担 (service_role 走 BYPASSRLS, 由 EF 代码自己
--    带 tenant_id 过滤).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- 4) 之后新建的对象自动继承 (避免下一个 migration 又踩同样的坑)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE                        ON FUNCTIONS TO anon, authenticated, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- 5) 让 PostgREST 立刻看到新权限
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
