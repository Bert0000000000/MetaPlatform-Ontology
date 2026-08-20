-- supabase/migrations/20260820170000_create_tenant_approval_config_and_escalation.sql
-- PRD: docs/active/prd/approval-saas-adapters.md §6.1 + §4.2
-- Batch: MP-V6-APPROVAL-01
-- tenant 配置: primary/fallback SaaS provider + 多级超时升级链

-- tenant 配置表
CREATE TABLE public.tenant_approval_config (
    tenant_id            uuid PRIMARY KEY REFERENCES public.tenants(id),
    primary_provider     text NOT NULL DEFAULT 'dingtalk'
                         CHECK (primary_provider IN ('dingtalk', 'feishu', 'wecom')),
    fallback_provider    text
                         CHECK (fallback_provider IN ('dingtalk', 'feishu', 'wecom')),
    app_key_env          text,                       -- ExternalSecret 引用名
    app_secret_secret_env text,
    enabled              boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_approval_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_approval_config IS
    '每租户的第三方审批 SaaS 配置 (primary + fallback + 凭证引用). RLS: 仅 service_role 全权.';

CREATE POLICY tenant_approval_config_all ON public.tenant_approval_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 多级超时升级链 (HITL-HUB-01 §4.2 扩展)
-- ============================================================
-- 升级阈值: 24h→B / 48h→C / 72h→D / 96h→expired

-- escalation_chain 配置表
CREATE TABLE public.tenant_escalation_chain (
    tenant_id         uuid NOT NULL REFERENCES public.tenants(id),
    escalation_level  int  NOT NULL CHECK (escalation_level BETWEEN 0 AND 3),
    approver_user_ids uuid[] NOT NULL DEFAULT '{}',
    timeout_hours     int  NOT NULL,           -- 该级别多久超时升级
    notify_template   text,
    PRIMARY KEY (tenant_id, escalation_level)
);

ALTER TABLE public.tenant_escalation_chain ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_escalation_chain IS
    '每租户的审批升级链. 0=初始审批人 / 1=B经理(24h) / 2=C总监(48h) / 3=D副总(72h).';

CREATE POLICY tenant_escalation_chain_select ON public.tenant_escalation_chain
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- pg_cron: 多级超时升级
-- ============================================================
-- 取消旧任务 (idempotent)
SELECT cron.unschedule('hitl-multi-level-escalation') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hitl-multi-level-escalation'
);

SELECT cron.schedule(
    'hitl-multi-level-escalation',
    '*/15 * * * *',  -- 每 15 分钟检查 (升级及时性)
    $$
    -- 自动升级 escalation_level 当 timeout 接近
    UPDATE public.hitl_requests hr
    SET
        escalation_level = hr.escalation_level + 1,
        -- 切换审批人到下一级别 (从 chain 配置读)
        approver_user_ids = COALESCE(
            (SELECT approver_user_ids FROM public.tenant_escalation_chain
             WHERE tenant_id = hr.tenant_id AND escalation_level = hr.escalation_level + 1
             LIMIT 1),
            hr.approver_user_ids
        ),
        updated_at = now()
    WHERE hr.status = 'pending'
      AND hr.type = 'workflow_saas'
      AND hr.escalation_level < 3
      AND hr.timeout_at < now() + (INTERVAL '15 minutes');

    -- Realtime 通知前端升级事件
    -- (由 dsp-webhook Edge Function 接收 + 处理)
    $$
);

-- 24h 升级: 触发 SaaS 通知 + 创建新 HITL
-- (HITL-HUB-01 已部分实现, 这里扩展 SaaS 端通知)

-- ============================================================
-- 升级事件审计表
-- ============================================================
CREATE TABLE public.hitl_escalation_events (
    id                  bigserial PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    hitl_request_id     uuid NOT NULL REFERENCES public.hitl_requests(id) ON DELETE CASCADE,
    from_level          int  NOT NULL,
    to_level            int  NOT NULL,
    reason              text,
    notified_user_ids   uuid[],
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hitl_escalation_events_idx ON public.hitl_escalation_events (hitl_request_id, created_at DESC);

ALTER TABLE public.hitl_escalation_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hitl_escalation_events IS
    '升级事件审计. 每次 escalation_level 变化写一行, 供事后追溯.';

CREATE POLICY hitl_escalation_events_select ON public.hitl_escalation_events
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE TRIGGER tg_hitl_escalation_events_audit
    AFTER INSERT OR UPDATE ON public.hitl_escalation_events
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();