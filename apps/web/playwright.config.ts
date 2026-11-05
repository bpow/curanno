import { defineConfig } from '@playwright/test';

/**
 * End-to-end test against the real stack: the compose Postgres and
 * Zitadel (see the repository README), the API and the Nuxt dev server.
 * The API is started from its build output unless one is already listening;
 * run `pnpm build` and `pnpm --filter @curanno/api migrate` first.
 */
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'node --env-file-if-exists=../../deploy/zitadel/.bootstrap/oidc.env --env-file-if-exists=../../.env ../api/dist/index.js',
      url: 'http://localhost:3000/readyz',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3001/',
      reuseExistingServer: !ci,
      timeout: 120_000,
    },
  ],
});
