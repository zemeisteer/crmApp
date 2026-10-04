import { defineConfig } from '@playwright/test';

const API_PORT = Number(process.env.BROWSER_API_PORT || 4300);
const WEB_PORT = Number(process.env.BROWSER_WEB_PORT || 3300);

// Critical browser flows against the production builds of the backend and
// the frontend, on a disposable database (see scripts/). Run:
//   npm run build:frontend && npm test
// PW_CHANNEL=chrome (or msedge) uses an installed browser instead of the
// downloaded Chromium; PW_EXECUTABLE_PATH a Chromium binary at that path
// (e.g. a preinstalled one of another Playwright revision).
export default defineConfig({
  testDir: './tests',
  // The journeys share two servers and the login rate limit: one at a time.
  workers: 1,
  fullyParallel: false,
  // Room for the sign-up/sign-in pacer (tests/support.ts authSlot), which may
  // wait up to a minute for the server's rate limit window.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // In CI, failures also become annotations: readable without opening the job log.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ...(process.env.CI ? [['github'] as const] : [])],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
    // Screenshots of synthetic data only. No traces or videos: a trace keeps
    // request headers and storage, i.e. session tokens.
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: 'node scripts/start-backend.cjs',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node scripts/start-frontend.cjs',
      url: `http://localhost:${WEB_PORT}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
