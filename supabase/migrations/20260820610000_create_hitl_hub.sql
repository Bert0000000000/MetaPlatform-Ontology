-- supabase/migrations/20260820610000_create_hitl_hub.sql
-- PRD:  docs/active/prd/hitl-hub.md
-- ADR:   docs/active/decisions/ADR-0053-hitl-hub.md
-- Batch: MetaPlatform-HITL-HUB-01 (Loop 1/3)
--
-- HITL Hub 统一表 hitl_requests (4 类型联动中枢)
--
-- 4 种 HITL 类型 (per ADR-0053 §7.9):
--   - workflow_saas: 业务用户 → 钉钉 / 飞书 / 企微审批
--   - workflow_dsh:  业务用户 → dsh Web 内联审批
--   - tool_dsh:      数字员工用户 → dsh Web 弹窗 (tool 调用拦截)
--   - action_confirm: 数字员工用户 → dsh Web 预览 (ActionType.apply mode='preview')
--
-- 状态机:
--   pending → approved / rejected / expired / cancelled
--
-- realtime 推送:
--   hitl_requests.status UPDATE → Realtime WS (mp-frontend-obs 监控 + 业务前端)
--
-- 长任务上下文 (M22 多级审批超时升级):
--   workflow_id (Temporal workflow id), escalation_level, deadline_at

-- ============================================================
-- Table: public.hitl_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hitl_requests (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),

    -- 类型 + 状态
    type            text NOT NULL CHECK (type IN ('workflow_saas', 'workflow_dsh', 'tool_dsh', 'action_confirm')),
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),

    -- 上下文
    title           text NOT NULL,
    description     text,
    requester_id    uuid NOT NULL REFERENCES auth.users(id),     -- 谁发起 (agent / user)
    approver_ids    uuid[] NOT NULL DEFAULT '{}',                -- 谁有权审批
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,          -- 类型相关数据 (workflow_id / tool_call / preview)

    -- 长任务 / Temporal 联动
    workflow_id     text,                                        -- Temporal workflow id (可选)
    temporal_signal text,                                        -- Temporal signal name (默认 'hitl_decision')
    escalation_level int NOT NULL DEFAULT 0,                     -- M22: 0=A / 1=B / 2=C / 3=D
    deadline_at     timestamptz,                                 -- 升级阈值时间

    -- 决策
    decided_by      uuid REFERENCES auth.users(id),
    decided_at      timestamptz,
    decision_note   text,

    -- 时间戳
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hitl_requests_tenant_idx
    ON public.hitl_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS hitl_requests_approver_idx
    ON public.hitl_requests USING gin (approver_ids);
CREATE INDEX IF NOT EXISTS hitl_requests_type_idx
    ON public.hitl_requests (tenant_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS hitl_requests_pending_deadline_idx
    ON public.hitl_requests (deadline_at)
    WHERE status = 'pending';

ALTER TABLE public.hitl_requests ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.hitl_requests IS
    'v6.0 HITL Hub: unified 4-type human-in-the-loop request. ADR-0053 §7.9. RLS: tenant 隔离.';

-- RLS
SELECT public._policy_tenant_select('public.hitl_requests'::regclass);
SELECT public._policy_tenant_insert('public.hitl_requests'::regclass);
SELECT public._policy_tenant_update('public.hitl_requests'::regclass);
SELECT public._policy_tenant_delete('public.hitl_requests'::regclass);

-- tg_inject_tenant + tg_audit 触发器
CREATE TRIGGER tg_hitl_requests_inject_tenant
    BEFORE INSERT ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_hitl_requests_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.hitl_requests TO anon, authenticated, service_role;

-- ============================================================
-- Realtime: hitl_requests 表 → WS 推送
-- ============================================================
-- Supabase Realtime 自动从 publication supabase_realtime 推送 INSERT/UPDATE/DELETE
-- 这里显式 add table 确保开启
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.hitl_requests;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Table already in publication, ignore
    NULL;
END $$;

-- ============================================================
-- View: hitl_pending_by_tenant (mp-audit dashboard 数据源)
-- ============================================================
CREATE OR REPLACE VIEW public.hitl_pending_by_tenant AS
SELECT
    tenant_id,
    type,
    count(*)::int AS pending_count,
    min(created_at) AS oldest_pending_at,
    max(deadline_at) AS latest_deadline_at
FROM public.hitl_requests
WHERE status = 'pending'
GROUP BY tenant_id, type;

GRANT SELECT ON public.hitl_pending_by_tenant TO anon, authenticated, service_role;

COMMENT ON VIEW public.hitl_pending_by_tenant IS
    'v6.0 HITL Hub: per-tenant pending HITL counts by type. Powers mp-audit dashboard + dsh-topbar badge.';

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_hitl_requests_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_hitl_requests_set_updated_at
    BEFORE UPDATE ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_hitl_requests_set_updated_at();