/**
 * Static server for the corpus. Looks in `trial/.build` first (bundles,
 * compiled framework apps, PDF viewer page) and then in the corpus directory,
 * so a case's `app.js` can be built from `app.tsx` next to it.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { BUILD_DIR } from './build.ts';
import { CORPUS_DIR } from './corpus.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function resolve(urlPath: string): Promise<string | null> {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  for (const base of [BUILD_DIR, CORPUS_DIR]) {
    const file = path.join(base, rel);
    if (!file.startsWith(base)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // try the next base
    }
  }
  return null;
}

export async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void resolve(url.pathname).then((file) => {
      if (!file) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      });
      createReadStream(file).pipe(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
