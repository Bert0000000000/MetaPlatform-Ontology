-- supabase/migrations/20260820630001_temporal_worker_cron.sql
-- pg_cron 每 30s 调 temporal-worker-consume (本地 dev 兜底)
-- 生产用 Realtime 订阅 workflow_signals UPDATE → worker 实时触发 (Loop 3/3 文档说明)

SELECT cron.unschedule('temporal-worker-consume-cron') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'temporal-worker-consume-cron'
);

SELECT cron.schedule(
    'temporal-worker-consume-cron',
    '*/1 * * * *',  -- 每 1 分钟 (本地 dev: 1 min 最小粒度; 生产: pg_cron 替代 → Realtime)
    $$
    SELECT
        net.http_post(
            url := current_setting('app.supabase_url') || '/functions/v1/temporal-worker-consume',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
            ),
            body := '{}'::jsonb,
            timeout_millisecond := 30000
        ) AS request_id;
    $$
);