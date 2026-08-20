-- supabase/migrations/20260820120000_init_extensions.sql
-- PRD: docs/active/prd/foundation-supabase-schema.md §4.1
-- Per CLAUDE.md §8 (强约束): 所有 v6.0 Supabase 实例必须启用以下 6 个扩展。
-- pgvector 版本由 Supabase Helm chart pin 0.7+ (AC7)。

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "vector"        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm"       WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gin"     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;

-- 业务代码应通过 search_path 访问 extensions.* 而非 public.*
-- Supabase 默认 search_path 已包含 extensions, 这里显式确认。
COMMENT ON SCHEMA extensions IS 'Shared Postgres extensions. search_path 优先于 public.';