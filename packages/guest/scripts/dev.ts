/**
 * Development placeholder: serves a sample page and the corpus pages on one
 * origin and the fake sidebar plus the guest bundle on another, rebuilds
 * the bundle on change, and prints the bookmarklet for trying the guest
 * on other pages. Plain http, so https pages block the bundle as mixed
 * content; use the served pages or an http page for those.
 *
 *   pnpm --filter @scale/guest dev
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bookmarkletUrl } from '@scale/guest';
import { BUILD_DIR, watchGuest } from './bundle.ts';
import { serve } from './serve.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const DEV_DIR = path.join(PACKAGE_DIR, 'dev');
const CORPUS_DIR = path.join(PACKAGE_DIR, 'corpus');
const HOST_PORT = 5180;
const SIDEBAR_PORT = 5181;

const stop = await watchGuest({ minify: false });
const sidebar = await serve({ host: 'localhost', port: SIDEBAR_PORT, roots: [DEV_DIR, BUILD_DIR] });
const bundleUrl = `${sidebar.origin}/guest.js`;
const sidebarOrigin = sidebar.origin;
const sidebarPath = '/sidebar.html';

const host = await serve({
  host: '127.0.0.1',
  port: HOST_PORT,
  roots: [CORPUS_DIR],
  pages: {
    '/': async () =>
      (await readFile(path.join(DEV_DIR, 'index.html'), 'utf8'))
        .replaceAll('__BUNDLE_URL__', bundleUrl)
        .replaceAll('__SIDEBAR_ORIGIN__', sidebarOrigin)
        .replaceAll('__SIDEBAR_PATH__', sidebarPath),
  },
});

console.log(`sample page    ${host.origin}/`);
console.log(`corpus pages   ${host.origin}/cases/<case>/<file>.html`);
console.log(`sidebar        ${sidebarOrigin}${sidebarPath}`);
console.log(`bundle         ${bundleUrl}`);
console.log('bookmarklet    ' + bookmarkletUrl({ bundleUrl, sidebarOrigin, sidebarPath }));

process.on('SIGINT', () => {
  void Promise.all([stop(), host.close(), sidebar.close()]).then(() => process.exit(0));
});
