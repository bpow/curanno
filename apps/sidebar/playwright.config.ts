import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the real stack: the compose Postgres and
 * Zitadel (see the repository README), the API and the Vite dev server.
 * The API is started from its build output unless one is already listening;
 * run `pnpm build` and `pnpm --filter @curanno/api migrate` first.
 */
const ci = !!process.env['CI'];

/** The port the API is started on: the environment wins over .env, as with node --env-file. */
function apiPort(): string {
  if (process.env['PORT']) return process.env['PORT'];
  try {
    return parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))['PORT'] ?? '3000';
  } catch {
    return '3000';
  }
}

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
      command:
        'node --env-file-if-exists=../../deploy/zitadel/.bootstrap/oidc.env --env-file-if-exists=../../.env ../api/dist/index.js',
      url: `http://localhost:${apiPort()}/readyz`,
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
