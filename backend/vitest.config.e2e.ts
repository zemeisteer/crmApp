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
    env: { DB_POOL_MAX: '4' },
  },
});
