import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { config as loadEnv } from 'dotenv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveE2eDatabase } = require('./test/e2e-database.cjs');

// The suites never run against the development (or any other) database:
// they get one of their own, named "..._e2e" (or CI's "..._test"). This
// throws - before anything connects - if the name is not a test name.
// See test/e2e-database.cjs and test/global-setup.ts.
loadEnv({ quiet: true });
const e2eDb = resolveE2eDatabase();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Each suite boots the full app and hashes passwords (bcrypt), and the
    // suites run in parallel; the 5s default is too tight on a busy machine.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: e2eDb.url,
      // Every suite opens its own DB pool: 10 suites x 10 connections would
      // hit Postgres' default max_connections (100).
      DB_POOL_MAX: '4',
      // No real AI in tests: suites stub it where they need answers, and a
      // developer's own key in .env must not be spent (or change results).
      GEMINI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      // Nothing leaves the machine either: no e-mail, Telegram or SMS provider.
      RESEND_API_KEY: '',
      SMTP_HOST: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_POLLING: 'false',
      ESKIZ_API_TOKEN: '',
      PLAYMOBILE_API_TOKEN: '',
      // Imports: no background polling - the suites drive the worker.
      IMPORT_QUEUE: `e2e-${process.pid}`,
      IMPORT_POLL_MS: '0',
    },
  },
});
