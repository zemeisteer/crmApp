import { defineConfig } from 'vitest/config';
import e2e from './vitest.config.e2e';

// Measurements, not assertions about speed: `npm run test:load` runs them on
// the disposable e2e database (never the development one) and prints the
// numbers. They are not part of the e2e suite (whose own files are not run
// here: `include` replaces the e2e one).
export default defineConfig({
  ...e2e,
  test: {
    ...e2e.test,
    include: ['test/load/**/*.load-spec.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
