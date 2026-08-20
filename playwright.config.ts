// playwright.config.ts
// MetaPlatform E2E Test Configuration
// - Test supabase (Auth, Edge Functions, RLS) — runs against localhost:54321
// - Test dsh-web (UI) — runs against localhost:5173 (when dsh-web is up)
//
// Run: pnpm exec playwright test
// UI:   pnpm exec playwright test --ui

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // sequential (single Supabase instance)
  workers: 1,
  retries: 0,                     // no auto-retry (deterministic tests)

  timeout: 30_000,                // 30s per test
  expect: { timeout: 5_000 },

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:54321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },

  projects: [
    {
      name: 'supabase-api',
      testMatch: /e2e\/(supabase-auth|edge-functions|list-presets|publish-preset|install-preset|uninstall-preset|multimodal-rag|multimodal-rag-video|mp-runtime|mp-knowledge|mp-sandbox|admin-server|hitl-hub)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'dsh-web-ui',
      testMatch: /e2e\/(dsh-web|dsh-topbar-mp|dsh-topbar-mp-internal)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
  ],
});