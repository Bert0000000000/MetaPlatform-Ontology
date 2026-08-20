-- supabase/migrations/20260820180000_create_event_queue_and_cron.sql
-- PRD: docs/active/prd/events-db-webhook.md §4.2 + §4.3
-- Batch: MetaPlatform-EVENTS-01
-- 事件队列 + 重试 + DLQ + pg_cron worker

-- ============================================================
-- 事件队列表
-- ============================================================
CREATE TABLE public.event_queue (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    event_type      text NOT NULL,                 -- e.g. 'order.created', 'hitl.broadcast'
    payload         jsonb NOT NULL,
    target_endpoint text NOT NULL,                 -- e.g. 'orderApprovalWorkflow', 'realtime'
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dlq')),
    attempts        int  NOT NULL DEFAULT 0,
    max_attempts    int  NOT NULL DEFAULT 5,
    last_error      text,
    next_retry_at   timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_queue_pending_idx ON public.event_queue (status, next_retry_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX event_queue_tenant_idx ON public.event_queue (tenant_id, created_at DESC);

ALTER TABLE public.event_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.event_queue IS
    'Database Webhook 事件队列. trigger 写此处, 异步 worker 消费并投递.
     失败 5 次后入 DLQ, 7 天后冷存储. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.event_queue'::regclass);
SELECT public._policy_tenant_insert('public.event_queue'::regclass);
SELECT public._policy_tenant_update('public.event_queue'::regclass);
SELECT public._policy_tenant_delete('public.event_queue'::regclass);

CREATE TRIGGER tg_event_queue_inject_tenant
    BEFORE INSERT ON public.event_queue
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

-- ============================================================
-- DLQ (失败 5 次的事件)
-- ============================================================
CREATE TABLE public.event_dlq (
    id              bigserial PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    event_id        bigint NOT NULL REFERENCES public.event_queue(id),
    event_type      text NOT NULL,
    payload         jsonb NOT NULL,
    target_endpoint text NOT NULL,
    failure_history jsonb NOT NULL DEFAULT '[]'::jsonb,
    archived_at     timestamptz,                -- 7 天后归档到冷存储
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_dlq_tenant_idx ON public.event_dlq (tenant_id, created_at DESC);

ALTER TABLE public.event_dlq ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.event_dlq IS
    'Dead-letter queue. 失败 ≥ 5 次的事件归档此处, 7 天后归档冷存储. RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.event_dlq'::regclass);
SELECT public._policy_tenant_insert('public.event_dlq'::regclass);
SELECT public._policy_tenant_delete('public.event_dlq'::regclass);

-- ============================================================
-- pg_cron: 事件重试 (每 5 分钟)
-- ============================================================
SELECT cron.unschedule('event-retry') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'event-retry'
);

SELECT cron.schedule(
    'event-retry',
    '*/5 * * * *',  -- 每 5 分钟
    $$
    -- 找 pending + next_retry_at < now() 的事件, attempts < max_attempts
    -- 重置 status=processing 防止并发
    WITH due AS (
        SELECT id FROM public.event_queue
        WHERE status IN ('pending', 'failed')
          AND next_retry_at < now()
          AND attempts < max_attempts
        ORDER BY next_retry_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.event_queue eq
    SET status = 'processing',
        attempts = attempts + 1,
        updated_at = now()
    FROM due
    WHERE eq.id = due.id;

    -- TODO: 实际投递逻辑由 dsp-webhook Edge Function 处理
    -- 此处仅做 status 更新 + attempts 计数
    $$
);

-- ============================================================
-- pg_cron: DLQ 清理 (每天)
-- ============================================================
SELECT cron.unschedule('event-dlq-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'event-dlq-cleanup'
);

SELECT cron.schedule(
    'event-dlq-cleanup',
    '0 3 * * *',  -- 每天 03:00
    $$
    -- 7 天前的 DLQ → 冷存储 (S3 Glacier) + 删除
    -- (TODO: 通过 Edge Function 调 S3 API)
    DELETE FROM public.event_dlq
    WHERE created_at < now() - interval '7 days';
    $$
);

-- ============================================================
-- pg_cron: audit_log 归档 (每周)
-- ============================================================
SELECT cron.unschedule('audit-log-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'audit-log-cleanup'
);

SELECT cron.schedule(
    'audit-log-cleanup',
    '0 4 * * 0',  -- 每周日 04:00
    $$
    -- 2 年前的 audit_log 按月归档到冷存储 + 删除
    -- (按 compliance 保留 2 年, 详见 foundation-dr-backup PRD §5)
    -- 简化: 直接 DELETE (生产应该归档)
    DELETE FROM public.audit_log
    WHERE occurred_at < now() - interval '2 years';
    $$
);

-- ============================================================
-- pg_cron: DB 健康检查 (每小时)
-- ============================================================
SELECT cron.unschedule('db-health-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'db-health-check'
);

SELECT cron.schedule(
    'db-health-check',
    '0 * * * *',  -- 每小时
    $$
    -- 表大小 + 索引膨胀 + 慢查询
    -- 上报到 Prometheus metrics endpoint
    -- (实际收集由 dsp-webhook 或 pgwatch2 完成, 此处仅 stub)
    $$
);

-- ============================================================
-- pg_cron: Webhook delivery stats (每小时)
-- ============================================================
SELECT cron.unschedule('webhook-delivery-stats') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'webhook-delivery-stats'
);

SELECT cron.schedule(
    'webhook-delivery-stats',
    '15 * * * *',  -- 每小时 :15
    $$
    -- 统计 event_queue.delivered / failed / dlq 数, 上报到 OTel metrics
    $$
);