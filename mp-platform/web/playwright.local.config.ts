// mp-platform/web/playwright.local.config.ts
// 在 mp-platform 子目录内运行的 Playwright 配置
// 作用: 绕过根目录 playwright.config.ts 的 testMatch 过滤, 只跑 mp-platform-web 的用例
//
// 用法 (从仓库根):
//   E2E_BASE_URL=http://127.0.0.1:5183 ./node_modules/.bin/playwright test \
//       --config=mp-platform/web/playwright.local.config.ts

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /e2e\/mp-platform-web\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'mp-platform/web/e2e-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5183',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'mp-platform-web',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
