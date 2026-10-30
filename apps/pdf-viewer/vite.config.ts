import { defineConfig } from 'vite';

/**
 * The viewer lives under `/pdf/`, where the API serves it; in production it
 * is reached through its own host name, apart from the sidebar's (ADR 0021).
 * In development the two dev servers are two origins already; the preview
 * server binds 127.0.0.1 so that it never shares `localhost` with the
 * sidebar's preview in the bookmarklet suite.
 */
export default defineConfig({
  base: '/pdf/',
  server: { port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
