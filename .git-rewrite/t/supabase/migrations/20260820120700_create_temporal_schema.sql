-- supabase/migrations/20260820120700_create_temporal_schema.sql
-- PRD: docs/active/prd/temporal-cluster.md §4.2 + foundation-rls-policy.md §6 (exemption)
-- Temporal Cluster 复用 Supabase Postgres, 用专用 schema + 专用 user.
-- Schema 下所有表 DISABLE ROW LEVEL SECURITY (系统账户全权访问).
-- RLS 豁免清单: evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md

CREATE SCHEMA IF NOT EXISTS temporal;
COMMENT ON SCHEMA temporal IS 'Owned by Temporal Cluster. RLS-exempt (system account). 见 evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md';

-- 专用 user; 密码由 Vault → ExternalSecret → K8s Secret, 永远不进 git
-- 这里只声明角色, 密码通过 supabase migration 之外的 init flow 注入
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'temporal_user') THEN
        CREATE ROLE temporal_user WITH LOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO temporal_user;
GRANT USAGE, CREATE ON SCHEMA temporal TO temporal_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO temporal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporal
    GRANT USAGE, SELECT ON SEQUENCES TO temporal_user;

-- 注意: temporal schema 下的表 (由 `temporal sql --setup-schema` 创建) 全部 RLS DISABLED.
-- 应用代码访问业务表走 public + RLS; Temporal workflow history 走 temporal schema.