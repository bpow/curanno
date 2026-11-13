/**
 * Serves the anchoring corpus and the built guest bundle on one origin, for
 * end-to-end tests that need a real loopback server as the annotated page
 * (Chromium refuses to let a page it cannot place on the network embed a
 * frame from localhost). Build the bundle first.
 *
 *   pnpm --filter @curanno/guest serve:corpus -- --host 127.0.0.1 --port 4180 [--root dir]
 *
 * `--root` adds a directory to serve (the bookmarklet suite's own pages).
 */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { serve } from './serve.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const CORPUS_DIR = path.join(PACKAGE_DIR, 'corpus');
const BUILD_DIR = path.join(PACKAGE_DIR, 'build');

const { values: args } = parseArgs({
  // pnpm passes on the `--` in `pnpm <script> -- --flag`.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '0' },
    root: { type: 'string', multiple: true, default: [] },
  },
});
const host = args.host;
const port = Number(args.port);
const extraRoots = args.root.map((root) => path.resolve(root));

try {
  await access(path.join(BUILD_DIR, 'guest.js'));
} catch {
  console.error(`no guest bundle in ${BUILD_DIR}; run pnpm --filter @curanno/guest bundle first`);
  process.exit(2);
}

const server = await serve({ host, port, roots: [...extraRoots, CORPUS_DIR, BUILD_DIR] });
console.log(`corpus and bundle at ${server.origin}`);
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
