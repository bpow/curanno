import { defineConfig } from 'vitest/config';

// One project for now. Packages that need a DOM environment (guest, sidebar)
// get their own config and this becomes a `projects` list when they arrive.
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/guest/trial/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
  },
});
