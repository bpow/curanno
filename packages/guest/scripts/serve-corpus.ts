/**
 * Serves the anchoring corpus and the built guest bundle on one origin, for
 * end-to-end tests that need a real loopback server as the annotated page
 * (Chromium refuses to let a page it cannot place on the network embed a
 * frame from localhost). Build the bundle first.
 *
 *   pnpm --filter @scale/guest serve:corpus -- --host 127.0.0.1 --port 4180 [--root dir]
 *
 * `--root` adds a directory to serve (the bookmarklet suite's own pages).
 */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { serve } from './serve.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const CORPUS_DIR = path.join(PACKAGE_DIR, 'corpus');
const BUILD_DIR = path.join(PACKAGE_DIR, 'build');

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const host = option(args, '--host') ?? '127.0.0.1';
const port = Number(option(args, '--port') ?? 0);
const extraRoots = args.flatMap((a, i) =>
  a === '--root' ? [path.resolve(args[i + 1] ?? '')] : [],
);

try {
  await access(path.join(BUILD_DIR, 'guest.js'));
} catch {
  console.error(`no guest bundle in ${BUILD_DIR}; run pnpm --filter @scale/guest bundle first`);
  process.exit(2);
}

const server = await serve({ host, port, roots: [...extraRoots, CORPUS_DIR, BUILD_DIR] });
console.log(`corpus and bundle at ${server.origin}`);
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
