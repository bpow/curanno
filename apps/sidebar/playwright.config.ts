import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the real stack: the compose Postgres and
 * Keycloak (see the repository README), the API and the Vite dev server.
 * The API is started from its build output unless one is already listening;
 * run `pnpm build` and `pnpm --filter @curanno/api migrate` first.
 */
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e',
  // The bookmarklet suite has its own stack (playwright.guest.config.ts).
  testIgnore: 'guest/**',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env ../api/dist/index.js',
      url: 'http://localhost:3000/readyz',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173/sidebar/',
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
  ],
});
