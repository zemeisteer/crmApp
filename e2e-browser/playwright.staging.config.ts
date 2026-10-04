import { defineConfig } from '@playwright/test';
import { resolveTarget } from '../scripts/staging/target.mjs';

// The same critical flows against an ALREADY DEPLOYED staging domain:
//
//   STAGING_ROOT=staging.example.uz STAGING_CONFIRM=staging.example.uz npm run test:staging
//
// - No server is started and no database is touched: there is no
//   webServer and nothing from scripts/ (which build disposable databases)
//   is used. The tests talk to https://<root> and https://<center>.<root>
//   like a browser would, and to https://<root>/api for fixtures.
// - The destination follows the staging check's rules (scripts/staging/
//   target.mjs): it must be confirmed by repeating it, look like a test
//   environment (staging/stage/stg/test), be HTTPS on the default port,
//   with no credentials, path or query - otherwise nothing runs.
// - Fixtures are synthetic "zzbr-..." centers and staff; the run deletes the
//   centers it made at the end (their staff accounts stay as unused
//   "zzbr-...@example.test" users).
// - Screenshots only on failure; no traces or videos (they hold tokens).
const root = (process.env.STAGING_ROOT || '').trim().toLowerCase();
const confirm = (process.env.STAGING_CONFIRM || '').trim().toLowerCase();
if (!root) throw new Error('Set STAGING_ROOT to the staging domain (e.g. staging.example.uz)');
if (confirm !== root) throw new Error('Set STAGING_CONFIRM to the same domain as STAGING_ROOT, to confirm the destination');
// Throws for anything that is not a confirmed, test-looking HTTPS destination.
resolveTarget({ api: `https://${root}/api`, root, confirm });
process.env.BROWSER_TARGET = 'staging';
process.env.STAGING_ROOT = root;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  // Room for the sign-up/sign-in pacer (tests/support.ts authSlot).
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-staging' }]],
  outputDir: 'test-results-staging',
  use: {
    baseURL: `https://${root}`,
    channel: process.env.PW_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
});
