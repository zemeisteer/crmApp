import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each suite boots the full app and hashes passwords (bcrypt), and the
    // suites run in parallel; the 5s default is too tight on a busy machine.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Every suite opens its own DB pool: 10 suites x 10 connections would
    // hit Postgres' default max_connections (100).
    // No real AI in tests: suites stub it where they need answers, and a
    // developer's own key in .env must not be spent (or change results).
    // Imports: a queue of this run's own (a dev server on the same database
    // must not pick these jobs up, nor these suites its jobs), and no
    // background polling - the suites drive the worker themselves.
    // Nothing leaves the machine either: no e-mail, Telegram or SMS provider.
    env: { DB_POOL_MAX: '4', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', SMTP_HOST: '', TELEGRAM_BOT_TOKEN: '', ESKIZ_API_TOKEN: '', PLAYMOBILE_API_TOKEN: '', IMPORT_QUEUE: `e2e-${process.pid}`, IMPORT_POLL_MS: '0' },
  },
});
