/**
 * Development server for the guest: serves a sample page and the corpus
 * pages on one origin, the guest bundle (and the fake sidebar) on another,
 * rebuilds the bundle on change, and prints the bookmarklet for trying the
 * guest on other pages. By default the guest opens the fake sidebar; with
 * `--sidebar-origin` it opens a real one, such as the sidebar dev server
 * (`just dev`, http://localhost:3001/sidebar/). Plain http,
 * so https pages block the bundle as mixed content; use the served pages or
 * an http page for those.
 *
 *   pnpm --filter @curanno/guest dev [--sidebar-origin http://localhost:3001 [--sidebar-path /sidebar/]]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bookmarkletUrl, validateSidebar } from '@curanno/guest';
import { devPort } from '../../../dev-ports.ts';
import { BUILD_DIR, watchGuest } from './bundle.ts';
import { serve } from './serve.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const DEV_DIR = path.join(PACKAGE_DIR, 'dev');
const CORPUS_DIR = path.join(PACKAGE_DIR, 'corpus');
const HOST_PORT = devPort('GUEST_PORT');
const GUEST_PORT = devPort('GUEST_BUNDLE_PORT');

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const stop = await watchGuest({ minify: false });
const guestServer = await serve({
  host: 'localhost',
  port: GUEST_PORT,
  roots: [DEV_DIR, BUILD_DIR],
});
const bundleUrl = `${guestServer.origin}/guest.js`;
const sidebarOrigin = option(args, '--sidebar-origin') ?? guestServer.origin;
const sidebarPath =
  option(args, '--sidebar-path') ??
  (sidebarOrigin === guestServer.origin ? '/sidebar.html' : '/sidebar/');
const problem = validateSidebar(sidebarOrigin, sidebarPath);
if (problem) {
  console.error(problem);
  process.exit(2);
}
const sidebarUrl = new URL(sidebarPath, sidebarOrigin).href;

const host = await serve({
  host: '127.0.0.1',
  port: HOST_PORT,
  roots: [CORPUS_DIR],
  pages: {
    '/': async () =>
      (await readFile(path.join(DEV_DIR, 'index.html'), 'utf8'))
        .replaceAll('__BUNDLE_URL__', bundleUrl)
        .replaceAll('__SIDEBAR_ORIGIN__', sidebarOrigin)
        .replaceAll('__SIDEBAR_PATH__', sidebarPath)
        .replaceAll('__SIDEBAR_URL__', sidebarUrl),
  },
});

console.log(`sample page    ${host.origin}/`);
console.log(`corpus pages   ${host.origin}/cases/<case>/<file>.html`);
console.log(`sidebar        ${sidebarUrl}${sidebarOrigin === guestServer.origin ? ' (fake)' : ''}`);
console.log(`bundle         ${bundleUrl}`);
console.log('bookmarklet    ' + bookmarkletUrl({ bundleUrl, sidebarOrigin, sidebarPath }));

process.on('SIGINT', () => {
  void Promise.all([stop(), host.close(), guestServer.close()]).then(() => process.exit(0));
});
