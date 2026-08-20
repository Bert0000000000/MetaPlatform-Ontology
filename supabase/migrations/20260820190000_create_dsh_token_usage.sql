-- supabase/migrations/20260820190000_create_dsh_token_usage.sql
-- PRD: docs/active/prd/llm-providers.md §4.4
-- Batch: MetaPlatform-LLM-01
-- dsh token meter (LLM 调用计费 + 用量分析)

CREATE TABLE public.dsh_token_usage (
    id              bigserial,
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
    session_id      uuid REFERENCES public.dsh_session_headers(id) ON DELETE SET NULL,
    provider        text NOT NULL,              -- 'deepseek-primary' | 'openai-secondary' | 'anthropic-tertiary'
    model           text NOT NULL,
    input_tokens    int  NOT NULL DEFAULT 0,
    output_tokens   int  NOT NULL DEFAULT 0,
    cost_usd        numeric(10, 6),              -- 估算成本
    duration_ms     int,
    preset          text,                        -- 'support-triage' | 'knowledge-curator' | ...
    status          text NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success', 'rate_limited', 'circuit_open', 'error')),
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 当月分区 (后续 batch 加更多分区)
CREATE TABLE public.dsh_token_usage_default PARTITION OF public.dsh_token_usage DEFAULT;

CREATE INDEX dsh_token_usage_tenant_idx ON public.dsh_token_usage (tenant_id, occurred_at DESC);
CREATE INDEX dsh_token_usage_provider_idx ON public.dsh_token_usage (provider, occurred_at DESC);
CREATE INDEX dsh_token_usage_session_idx ON public.dsh_token_usage (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.dsh_token_usage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dsh_token_usage IS
    'dsh token meter: 每次 LLM 调用写一行 (provider/model/tokens/cost). RLS: tenant 隔离.
     按月分区, 3 个月后归档冷存储. 用于 token 用量分析 + 成本告警.';

-- 仅 service_role 写 (dsh 内部写)
CREATE POLICY dsh_token_usage_service_write ON public.dsh_token_usage
    FOR INSERT TO service_role WITH CHECK (true);

-- tenant 可读自己的
CREATE POLICY dsh_token_usage_tenant_select ON public.dsh_token_usage
    FOR SELECT TO authenticated
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 价格表 (估算 cost_usd)
-- ============================================================
CREATE TABLE public.llm_pricing (
    provider    text NOT NULL,
    model       text NOT NULL,
    input_per_1k_tokens  numeric(10, 6) NOT NULL,  -- USD per 1k input tokens
    output_per_1k_tokens numeric(10, 6) NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, model)
);

-- 默认价格 (DeepSeek 主用 + OpenAI/An 备选)
INSERT INTO public.llm_pricing (provider, model, input_per_1k_tokens, output_per_1k_tokens) VALUES
    ('deepseek-primary',   'deepseek-chat',     0.00014,   0.00028),    -- DeepSeek 官方
    ('openai-secondary',   'gpt-4o-mini',       0.00015,   0.00060),
    ('anthropic-tertiary', 'claude-3-5-sonnet', 0.00300,   0.01500)
ON CONFLICT (provider, model) DO UPDATE SET
    input_per_1k_tokens = EXCLUDED.input_per_1k_tokens,
    output_per_1k_tokens = EXCLUDED.output_per_1k_tokens,
    updated_at = now();

COMMENT ON TABLE public.llm_pricing IS
    'LLM 价格表 (USD per 1k tokens). 用于 dsh_token_usage.cost_usd 估算.';