import { defineConfig, devices } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
const START_DEV = !process.env.DASHBOARD_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: DASHBOARD_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: START_DEV ? {
    command: 'npm run dev --workspace=@mydash-rx/dashboard',
    url: DASHBOARD_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:3001',
    },
  } : undefined,
});
