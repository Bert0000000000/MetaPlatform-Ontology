# MetaPlatform E2E Tests (Playwright)

Playwright end-to-end tests for v6.0 platform. Tests Supabase Auth + RLS + Edge Functions + pg_cron + dsh-web UI.

## Quick Start

```bash
# 1. Install Playwright + Chromium
pnpm add -D -w @playwright/test
npx playwright install chromium

# 2. Set env (use real keys from `supabase status`)
export SUPABASE_ANON_KEY="eyJ..."
export SUPABASE_SERVICE_KEY="eyJ..."

# 3. Run all tests
pnpm exec playwright test

# 4. Run specific project
pnpm exec playwright test --project=supabase-api
pnpm exec playwright test --project=dsh-web-ui
```

## Test Suites

| File | Project | What it tests |
|---|---|---|
| `supabase-auth.spec.ts` | supabase-api | signup + login + JWT claims + RLS cross-tenant isolation |
| `edge-functions.spec.ts` | supabase-api | create-customer dedup + send-notification + ticket-triage HITL |
| `dsh-web.spec.ts` | dsh-web-ui | homepage + /health + boot manifest + presets + Realtime WS |

## Requisitos

- Supabase local running (port 54321)
- pg_cron jobs active (28 SQL migrations applied)
- 28 Supabase tables with RLS
- dsh-web running on 3080 (for `dsh-web` project)
- DEEPSEEK_API_KEY env var (for LLM calls in dsh)

## Reports

- HTML report: `e2e-report/index.html`
- Traces + videos: `test-results/`

## CI Integration

Add to `.github/workflows/ci.yml`:
```yaml
- name: E2E tests
  run: |
    pnpm exec playwright install chromium
    pnpm exec playwright test
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: e2e-report
    path: e2e-report/
```
