import { defineConfig, type Plugin } from 'vite';
import { devPort } from '../../dev-ports.ts';

/**
 * The viewer lives under `/pdf/`, where the API serves it; in production it
 * is reached through its own host name, apart from the sidebar's (ADR 0021).
 * In development the two dev servers are two origins already; the preview
 * server binds 127.0.0.1 so that it never shares `localhost` with the
 * sidebar's preview in the bookmarklet suite.
 */

/** The dev server's `config.json`, which the API generates in a deployment. */
function devConfig(): Plugin {
  return {
    name: 'curanno-dev-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/pdf/config.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            sidebarOrigin: `http://localhost:${devPort('WEB_PORT')}`,
            sidebarPath: '/sidebar/',
          }),
        );
      });
    },
  };
}

export default defineConfig({
  base: '/pdf/',
  plugins: [devConfig()],
  server: { port: devPort('PDF_VIEWER_PORT'), strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
