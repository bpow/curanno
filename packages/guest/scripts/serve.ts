/**
 * A static server over an ordered list of directories, for the dev
 * placeholder and the browser tests. Files are looked up in each root in
 * turn; `pages` maps a URL path to literal content.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface ServeOptions {
  roots: string[];
  /** Literal responses by path, checked before the roots. */
  pages?: Record<string, string | (() => string | Promise<string>)>;
  /** `127.0.0.1`, `localhost` or `::1`: different names give different origins on one machine. */
  host: string;
  port?: number;
}

export interface StaticServer {
  origin: string;
  close: () => Promise<void>;
}

async function resolveFile(roots: string[], urlPath: string): Promise<string | null> {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  for (const base of roots) {
    const file = path.join(base, rel === '/' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(base)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // next root
    }
  }
  return null;
}

export async function serve(options: ServeOptions): Promise<StaticServer> {
  const hostname = options.host.includes(':') ? `[${options.host}]` : options.host;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${hostname}`);
    const page = options.pages?.[url.pathname];
    if (page !== undefined) {
      void Promise.resolve(typeof page === 'function' ? page() : page).then((body) => {
        res.writeHead(200, { 'content-type': TYPES['.html'] as string });
        res.end(body);
      });
      return;
    }
    void resolveFile(options.roots, url.pathname).then((file) => {
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
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no address');
  return {
    origin: `http://${hostname}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
