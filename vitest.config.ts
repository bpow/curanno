import { defineConfig } from 'vitest/config';

// Node tests here; the sidebar needs a DOM environment and the Vue plugin,
// so it is its own project.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/guest/trial/src/**/*.test.ts',
            'apps/api/src/**/*.test.ts',
          ],
        },
      },
      'apps/sidebar/vitest.config.ts',
    ],
  },
});
