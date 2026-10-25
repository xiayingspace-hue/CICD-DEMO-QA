import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// 结尾补 /，相对路径（如 'auth/login'）才会拼在服务前缀 /defect-service 之后
const API_URL = (process.env.API_BASE_URL ?? 'http://localhost:8080/defect-service').replace(/\/?$/, '/');
const WEB_URL = process.env.WEB_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: API_URL, extraHTTPHeaders: { Accept: 'application/json' } },
    },
    {
      name: 'e2e-chromium',
      // TC-029 在 API 与 E2E 中共用 owner-revoke 并改其状态，必须串行
      dependencies: ['api'],
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL, screenshot: 'only-on-failure', video: 'retain-on-failure' },
    },
  ],
});
