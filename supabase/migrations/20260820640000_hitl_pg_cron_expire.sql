-- supabase/migrations/20260820640000_hitl_pg_cron_expire.sql
-- pg_cron 每 5 分钟调一次 expire-overdue-hitl EF
-- (本地 dev pg_cron 已启, 见 supabase/migrations/20260820120600_tg_inject_tenant.sql 同一 migration)
--
-- 注: pg_cron + Database Webhook 链路生产推荐.
-- 本地用 pg_cron.net.http_post 直接调 EF (Loop 3/3 升级)

SELECT cron.unschedule('hitl-expire-overdue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-expire-overdue'
);

SELECT cron.schedule(
    'hitl-expire-overdue',
    '*/5 * * * *',  -- 每 5 分钟
    $$
    SELECT
        net.http_post(
            url := current_setting('app.supabase_url') || '/functions/v1/expire-overdue-hitl',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
            ),
            body := '{}'::jsonb,
            timeout_millisecond := 10000
        ) AS request_id;
    $$
);