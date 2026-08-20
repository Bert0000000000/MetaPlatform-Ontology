-- supabase/migrations/20260820601000_drop_mp_sandbox_record_execution_rpc.sql
-- PRD:  docs/active/prd/mp-sandbox.md
-- ADR:   docs/active/decisions/ADR-0069-mp-sandbox-poc.md
-- Issue: #15 (mp-sandbox 生产路径 §3 — Loop 2/3)
--
-- 这一步 (Loop 2/3 of issue #15 §3):
--   1. 删 mp_sandbox.record_execution RPC (PoC 阶段用)
--   2. 删 public.record_execution wrapper (PostgREST 兼容层)
--   3. mp_sandbox.executions 表 tg_audit 触发器自动写 public.audit_log (Loop 1/3 已挂)
--   4. EF 切换: 不再调用 RPC, 只 INSERT mp_sandbox.executions (Loop 1/3 已加 helper, 这次彻底删 RPC 路径)
--
-- Loop 3/3 (issue #15 §3) 后续:
--   - sidecar HTTP 接入, EF 读 mp_sandbox.executions 状态
--   - async 路径 K8s Job

-- ============================================================
-- Drop: public.record_execution (wrapper)
-- ============================================================
DROP FUNCTION IF EXISTS public.record_execution(uuid, uuid, text, text, text, int, int, text, int, int, int, int, jsonb);

-- ============================================================
-- Drop: mp_sandbox.record_execution (SECURITY DEFINER RPC)
-- ============================================================
DROP FUNCTION IF EXISTS mp_sandbox.record_execution(uuid, uuid, text, text, text, int, int, text, int, int, int, int, jsonb);

-- ============================================================
-- Verify: tg_audit trigger on mp_sandbox.executions 自动写 audit_log
-- ============================================================
-- (Loop 1/3 已在 migration 20260820600000 挂载, 这里只是验证注释)
COMMENT ON TABLE mp_sandbox.executions IS
    'v6.0 mp-sandbox: structured execution record. mode: poc_mock (PoC) | sidecar_sync (production <30s) | k8s_job_async (production >30s). RLS: tenant 隔离. audit_log 通过 tg_mp_sandbox_executions_audit 触发器自动写入 (action=INSERT/UPDATE/DELETE). Issue #15 Loop 2/3.';