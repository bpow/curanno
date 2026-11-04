import { defineConfig } from '@playwright/test';

/**
 * The bookmarklet suite: the built guest bundle injected into corpus pages
 * the way the bookmarklet does it, the built sidebar in the iframe, and the
 * API answered by Playwright routes, so it needs neither Zitadel nor
 * Postgres. The pages come from real loopback servers (one on 127.0.0.1,
 * one on ::1 for the origin the sidebar must refuse), because Chromium does
 * not let a page it cannot place on the network embed a localhost frame.
 * The PDF case opens the built viewer app on its preview server, on an
 * origin of its own as in a deployment. Build first:
 *
 *   pnpm build && pnpm --filter @curanno/guest bundle && pnpm --filter @curanno/sidebar build && pnpm --filter @curanno/pdf-viewer build
 */
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e/guest',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm preview',
      url: 'http://localhost:4173/sidebar/',
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @curanno/pdf-viewer preview',
      url: 'http://127.0.0.1:4174/pdf/',
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command:
        'node ../../packages/guest/scripts/serve-corpus.ts --host 127.0.0.1 --port 4180 --root e2e/guest/pages',
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
