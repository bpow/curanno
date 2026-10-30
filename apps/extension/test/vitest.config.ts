import { defineConfig } from 'vitest/config';

/**
 * Browser tests: they build the extension and load it into Chromium, so
 * they run apart from `pnpm test` through
 * `pnpm --filter @curanno/extension test:browser`.
 */
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
