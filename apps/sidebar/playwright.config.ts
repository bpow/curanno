import { defineConfig } from '@playwright/test';
import { devPort } from '../../dev-ports.ts';

/**
 * End-to-end tests against the real stack: the compose Postgres and
 * Zitadel (see the repository README), the API and the Vite dev server.
 * The API is started from its build output unless one is already listening;
 * run `pnpm build` and `pnpm --filter @curanno/api migrate` first.
 */
const ci = !!process.env['CI'];
// With the embedded issuer (ADR 0028) the issuer, and its sign-in page, are served from the site's origin.
const embedded = process.env['E2E_AUTH'] === 'embedded';

export default defineConfig({
  testDir: 'e2e',
  // The bookmarklet suite has its own stack (playwright.guest.config.ts).
  testIgnore: 'guest/**',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${devPort('SIDEBAR_PORT')}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'node --env-file-if-exists=../../deploy/zitadel/.bootstrap/oidc.env --env-file-if-exists=../../.env ../api/dist/index.js',
      url: `http://localhost:${devPort('PORT')}/readyz`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      url: `http://localhost:${devPort('SIDEBAR_PORT')}/sidebar/`,
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
    ...(embedded
      ? [
          {
            command: 'pnpm --filter @curanno/web dev',
            url: `http://localhost:${devPort('WEB_PORT')}/`,
            reuseExistingServer: !ci,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
