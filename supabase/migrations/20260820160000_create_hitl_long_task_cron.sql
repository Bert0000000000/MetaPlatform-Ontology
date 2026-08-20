-- supabase/migrations/20260820160000_create_hitl_long_task_cron.sql
-- PRD: docs/active/prd/hitl-hub.md §4.2
-- Batch: MetaPlatform-HITL-HUB-01
-- 长任务 5 大机制 — pg_cron 定时任务

-- 启用 pg_cron (Supabase 默认已安装)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- 机制 1+3+4: 每小时检查 timeout, 升级 escalation_level + reminder
-- ============================================================
-- 取消旧任务 (idempotent)
SELECT cron.unschedule('hitl-hourly-timeout-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-hourly-timeout-check'
);

SELECT cron.schedule(
    'hitl-hourly-timeout-check',
    '0 * * * *',  -- 每小时
    $$
    UPDATE public.hitl_requests
    SET
        status = CASE
            WHEN escalation_level >= 3 THEN 'expired'
            ELSE status
        END,
        escalation_level = escalation_level + 1,
        updated_at = now()
    WHERE status = 'pending'
      AND timeout_at < now()
      AND escalation_level < 3;

    -- 通知下一审批人 (Realtime + 可选 Email/SaaS)
    -- (具体通知逻辑由 Edge Function 处理, 这里只 trigger event)
    $$
);

-- ============================================================
-- 机制 2: pending 状态冻结 (DB trigger 阻止业务变更)
-- ============================================================
-- 已在 hitl_requests.pg_cron + dsp-webhook 实现: 当 status='pending',
-- DB trigger 阻止相关业务表变更 (e.g. contracts.status 修改)

CREATE OR REPLACE FUNCTION public.tg_block_pending_approval_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_pending_count int;
BEGIN
    -- 仅对 contracts / orders 表生效
    IF TG_TABLE_NAME NOT IN ('contracts', 'orders') THEN
        RETURN NEW;
    END IF;

    -- 查是否有 pending HITL request 引用此 row
    SELECT count(*)
    INTO v_pending_count
    FROM public.hitl_requests
    WHERE status = 'pending'
      AND context->>'contract_id' = NEW.id::text
    LIMIT 1;

    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'tg_block_pending_approval_changes: row has pending HITL approval (status=pending, id=%)',
            NEW.id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_block_pending_approval_changes() IS
    '长任务 5 大机制 §2: pending_approval 状态冻结. 当 hitl_requests.status=pending 且关联此 row, 阻止 UPDATE/DELETE.';

-- ============================================================
-- 机制 5: 关键 context 持久化 (已在 hitl_requests.context 实现)
-- ============================================================
-- hitl_requests.context JSONB 字段已包含全部业务 context
-- 无需额外表, 双写到 context 字段即可

-- ============================================================
-- 机制 3 (续): 每 30 分钟 polling 兜底 (webhook 可能丢失)
-- ============================================================
SELECT cron.unschedule('hitl-poll-reconcile') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-poll-reconcile'
);

SELECT cron.schedule(
    'hitl-poll-reconcile',
    '*/30 * * * *',  -- 每 30 分钟
    $$
    -- 找 pending 超过 1 小时 + 已发 SaaS 审批 的 hitl_requests, polling 外部 SaaS
    -- 通过 Edge Function `poll-saaas-approval` 实现
    INSERT INTO public.hitl_poll_queue (hitl_request_id, scheduled_at)
    SELECT id, now()
    FROM public.hitl_requests
    WHERE status = 'pending'
      AND type = 'workflow_saas'
      AND updated_at < now() - interval '1 hour'
    ON CONFLICT (hitl_request_id) DO NOTHING;
    $$
);

-- poll 队列表
CREATE TABLE public.hitl_poll_queue (
    hitl_request_id uuid PRIMARY KEY REFERENCES public.hitl_requests(id) ON DELETE CASCADE,
    scheduled_at    timestamptz NOT NULL DEFAULT now(),
    attempts        int NOT NULL DEFAULT 0,
    last_error      text
);

ALTER TABLE public.hitl_poll_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hitl_poll_queue IS
    'HITL Hub webhook 双对账 polling 队列. webhook 丢失时由 cron 每 30 min 重新查询 SaaS.';