-- supabase/migrations/20260820630000_create_workflow_signals.sql
-- PRD:  docs/active/prd/hitl-hub.md
-- ADR:   docs/active/decisions/ADR-0053-hitl-hub.md
-- Batch: MetaPlatform-HITL-HUB-01 (Loop 2/3)
--
-- HITL Hub → Temporal 联动: workflow_signals 队列
--   1. hitl_requests UPDATE (status → approved/rejected) → trigger INSERT workflow_signals
--   2. Temporal worker (mp-workflow namespace) 消费 workflow_signals.status='pending'
--   3. worker 调 Temporal workflow.signal(workflow_id, signal_name, payload)
--   4. worker UPDATE status='sent' 并记录 sent_at
--   5. workflow 完成 → worker UPDATE status='acknowledged'
--
-- 注: 当前 sandbox 无 Temporal cluster, 所以保留"pending"状态 + 提供 consume-workflow-signal EF
-- 给 worker 调用. 生产 Temporal worker (K8s) 会订阅 pending 状态行.

CREATE TABLE IF NOT EXISTS public.workflow_signals (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    hitl_request_id uuid NOT NULL REFERENCES public.hitl_requests(id) ON DELETE CASCADE,
    workflow_id     text NOT NULL,                                 -- Temporal workflow id (e.g. "OrderApprovalWorkflow:order-123")
    signal_name     text NOT NULL DEFAULT 'hitl_decision',        -- Temporal signal name
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,            -- { decision: 'approved'|'rejected', decided_by, decided_at, note }
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'acknowledged', 'failed')),
    error           text,
    sent_at         timestamptz,
    acknowledged_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(hitl_request_id)
);

CREATE INDEX IF NOT EXISTS workflow_signals_status_idx
    ON public.workflow_signals (status, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workflow_signals_tenant_idx
    ON public.workflow_signals (tenant_id, created_at DESC);

ALTER TABLE public.workflow_signals ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.workflow_signals IS
    'v6.0 HITL Hub ↔ Temporal: hitl 决策 → Temporal signal 队列. ADR-0053 §7.11. RLS: tenant 隔离.';

-- RLS: tenant 读自己的 (admin/owner), service_role 全权
SELECT public._policy_tenant_select('public.workflow_signals'::regclass);
SELECT public._policy_tenant_insert('public.workflow_signals'::regclass);
SELECT public._policy_tenant_update('public.workflow_signals'::regclass);
SELECT public._policy_tenant_delete('public.workflow_signals'::regclass);

CREATE TRIGGER tg_workflow_signals_inject_tenant
    BEFORE INSERT ON public.workflow_signals
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_workflow_signals_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.workflow_signals
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.workflow_signals TO anon, authenticated, service_role;

-- ============================================================
-- Realtime: workflow_signals → supabase_realtime publication
--   让 mp-workflow worker 通过 Realtime WS 订阅 status='pending' 行 (低延迟推送)
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_signals;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================================
-- Trigger: hitl_requests UPDATE → INSERT workflow_signals
--   只在 status 从 pending 变为 approved/rejected 时触发 (workflow_id 非空)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_hitl_to_workflow_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status IN ('approved', 'rejected')
       AND (OLD.status IS NULL OR OLD.status = 'pending')
       AND NEW.workflow_id IS NOT NULL
    THEN
        INSERT INTO public.workflow_signals (
            tenant_id, hitl_request_id, workflow_id, signal_name, payload
        ) VALUES (
            NEW.tenant_id,
            NEW.id,
            NEW.workflow_id,
            COALESCE(NEW.temporal_signal, 'hitl_decision'),
            jsonb_build_object(
                'decision', NEW.status,
                'decided_by', NEW.decided_by,
                'decided_at', NEW.decided_at,
                'note', NEW.decision_note
            )
        )
        ON CONFLICT (hitl_request_id) DO UPDATE
            SET payload = EXCLUDED.payload,
                status = 'pending',
                error = NULL;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_hitl_to_workflow_signal() IS
    'M13 HITL Hub ↔ Temporal: hitl_requests UPDATE → INSERT workflow_signals (status=approved/rejected, workflow_id 非空). ON CONFLICT 幂等: 重新决策时覆盖 payload + 重置 pending.';

CREATE TRIGGER tg_hitl_requests_to_workflow_signal
    AFTER INSERT OR UPDATE ON public.hitl_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_hitl_to_workflow_signal();