/**
 * A static server over an ordered list of directories, for the dev
 * placeholder and the browser tests. Files are looked up in each root in
 * turn; `pages` maps a URL path to literal content.
 */
import http from 'node:http';
import sirv from 'sirv';

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

export async function serve(options: ServeOptions): Promise<StaticServer> {
  const hostname = options.host.includes(':') ? `[${options.host}]` : options.host;
  // Read from disk on every request: the bundle is rebuilt while the server runs.
  const roots = options.roots.map((root) =>
    sirv(root, {
      dev: true,
      // Cross-origin reads, so the PDF viewer on another origin can load corpus files.
      setHeaders: (res) => res.setHeader('access-control-allow-origin', '*'),
    }),
  );
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${hostname}`);
    const page = options.pages?.[url.pathname];
    if (page !== undefined) {
      void Promise.resolve(typeof page === 'function' ? page() : page).then((body) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      });
      return;
    }
    const tryRoot = (index: number): void => {
      const root = roots[index];
      if (root) root(req, res, () => tryRoot(index + 1));
      else res.writeHead(404).end('not found');
    };
    tryRoot(0);
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no address');
  return {
    origin: `http://${hostname}:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
