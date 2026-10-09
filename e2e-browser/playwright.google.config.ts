import { defineConfig } from '@playwright/test';

// Google Calendar's connected states in the browser, against a LOCAL fake
// Google (scripts/fake-google.cjs) - nothing reaches Google. Separate from
// the default suite, whose server has no Google credentials (calendar.spec.ts
// checks that the page says so). Run:
//   npm run build:frontend && npm run test:google
// The backend gets Google settings pointing at the fake (scripts/env.cjs,
// BROWSER_GOOGLE=fake); BROWSER_FAKE_GOOGLE_PORT moves the fake (4399).
process.env.BROWSER_GOOGLE = 'fake';
const API_PORT = Number(process.env.BROWSER_API_PORT || 4300);
const WEB_PORT = Number(process.env.BROWSER_WEB_PORT || 3300);
const FAKE_PORT = Number(process.env.BROWSER_FAKE_GOOGLE_PORT || 4399);

export default defineConfig({
  testDir: './tests-google',
  workers: 1,
  fullyParallel: false,
  // Room for the sign-up/sign-in pacer (tests/support.ts authSlot).
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-google' }], ...(process.env.CI ? [['github'] as const] : [])],
  outputDir: 'test-results-google',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
    // Screenshots of synthetic data only; no traces or videos (they hold tokens).
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: 'node scripts/fake-google.cjs',
      url: `http://127.0.0.1:${FAKE_PORT}/__fake/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
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
