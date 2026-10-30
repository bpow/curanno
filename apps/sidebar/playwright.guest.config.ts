import { defineConfig } from '@playwright/test';

/**
 * The bookmarklet suite: the built guest bundle injected into corpus pages
 * the way the bookmarklet does it, the built sidebar in the iframe, and the
 * API answered by Playwright routes, so it needs neither Keycloak nor
 * Postgres. The pages come from real loopback servers (one on 127.0.0.1,
 * one on ::1 for the origin the sidebar must refuse), because Chromium does
 * not let a page it cannot place on the network embed a localhost frame.
 * Build first:
 *
 *   pnpm build && pnpm --filter @scale/guest bundle && pnpm --filter @scale/sidebar build
 */
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e/guest',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command: 'node ../../packages/guest/scripts/serve-corpus.ts --host 127.0.0.1 --port 4180',
      url: 'http://127.0.0.1:4180/guest.js',
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command: 'node ../../packages/guest/scripts/serve-corpus.ts --host ::1 --port 4181',
      url: 'http://[::1]:4181/guest.js',
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
  ],
});
