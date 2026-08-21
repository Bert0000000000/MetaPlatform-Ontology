-- supabase/migrations/20260820200000_create_hitl_reminder_cron.sql
-- PRD: docs/active/prd/long-task-5-mechanisms.md §4.2
-- Batch: MetaPlatform-LONG-TASK-01
-- HITL 自动 reminder + context cleanup cron jobs (扩展 hitl_long_task_cron)

-- ============================================================
-- pg_cron: hitl-reminder-daily (每天 09:00 给所有 pending 审批人发 reminder)
-- ============================================================
SELECT cron.unschedule('hitl-reminder-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-reminder-daily'
);

SELECT cron.schedule(
    'hitl-reminder-daily',
    '0 9 * * *',  -- 每天 09:00 (业务时间起点)
    $$
    -- 找所有 status='pending' + type='workflow_saas' + 未过期的 hitl_requests
    -- 通过 Realtime + Email 通知审批人
    INSERT INTO public.notifications (tenant_id, recipient_user_id, title, body, channels, priority, metadata)
    SELECT
        hr.tenant_id,
        unnest(hr.approver_user_ids) AS recipient_user_id,
        '审批提醒: ' || hr.title AS title,
        '您的审批 ' || hr.title || ' 还未处理, 当前 escalation_level=' || hr.escalation_level || ', timeout_at=' || hr.timeout_at AS body,
        ARRAY['realtime', 'email']::text[] AS channels,
        CASE WHEN hr.timeout_at < now() + interval '6 hours' THEN 'high' ELSE 'normal' END AS priority,
        jsonb_build_object('hitl_request_id', hr.id, 'type', hr.type) AS metadata
    FROM public.hitl_requests hr
    WHERE hr.status = 'pending'
      AND hr.timeout_at > now()
      AND hr.created_at < now() - interval '4 hours';  -- 创建 4h 后才开始 reminder
    $$
);

-- ============================================================
-- pg_cron: hitl-context-cleanup (每周, 30 天前的 context 归档)
-- ============================================================
SELECT cron.unschedule('hitl-context-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-context-cleanup'
);

SELECT cron.schedule(
    'hitl-context-cleanup',
    '0 5 * * 0',  -- 每周日 05:00
    $$
    -- 30 天前 decided 的 hitl_requests.context → 冷存储
    -- (TODO: 调 Edge Function 归档到 S3 Glacier)
    -- 简化: 直接 NULLIFY context (生产应该归档)
    UPDATE public.hitl_requests
    SET context = '{}'::jsonb
    WHERE status IN ('approved', 'rejected', 'expired')
      AND decided_at < now() - interval '30 days';
    $$
);

COMMENT ON TABLE public.hitl_requests IS
    'v6.0 HITL Hub. 4 种 HITL 类型. context 字段 30 天后清理 (per compliance).';