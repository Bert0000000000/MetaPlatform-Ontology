-- supabase/migrations/20260820130940_create_notifications_table.sql
-- PRD: docs/active/specs/2026-08-19-mp-v6-application-architecture.md §2 (notifications domain)
-- v6.0 业务表: notifications (P2 域, send-notification Edge Function 依赖)

CREATE TABLE public.notifications (
    id                  bigserial PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id),
    recipient_user_id   uuid NOT NULL REFERENCES auth.users(id),
    title               text NOT NULL,
    body                text,
    channels            text[] NOT NULL DEFAULT ARRAY['realtime']::text[],
    priority            text NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high')),
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_tenant_recipient_idx ON public.notifications (tenant_id, recipient_user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON public.notifications (tenant_id, recipient_user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notifications IS 'P2 业务表: notifications (多通道通知: realtime / email / sms / push). RLS: tenant 隔离.';

SELECT public._policy_tenant_select('public.notifications'::regclass);
SELECT public._policy_tenant_insert('public.notifications'::regclass);
SELECT public._policy_tenant_update('public.notifications'::regclass);
SELECT public._policy_tenant_delete('public.notifications'::regclass);

CREATE TRIGGER tg_notifications_inject_tenant
    BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.tg_inject_tenant();

CREATE TRIGGER tg_notifications_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit();