import { defineConfig } from 'vitest/config';

// Node tests here; the sidebar and the management site need a DOM
// environment and the Vue plugin, so each is its own project.
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
            'apps/pdf-viewer/src/**/*.test.ts',
          ],
        },
      },
      'apps/sidebar/vitest.config.ts',
      'apps/web/vitest.config.ts',
    ],
  },
});
