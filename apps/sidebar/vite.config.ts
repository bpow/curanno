import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

/**
 * In development the API is proxied under the sidebar's own origin, which is
 * how production serves the two as well (the OpenAPI document's server URL
 * is `/`). `frame-ancestors` is the clickjacking defence from ADR 0007: only
 * the listed host origins may embed the sidebar. The app lives under
 * `/sidebar/`, where the API serves it in production (ADR 0021), so the
 * development URLs are the deployed ones. See README.md.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const apiTarget = env['VITE_API_PROXY_TARGET'] || 'http://localhost:3000';
  const frameAncestors =
    env['VITE_FRAME_ANCESTORS'] || "'self' http://localhost:* http://127.0.0.1:*";
  const headers = { 'Content-Security-Policy': `frame-ancestors ${frameAncestors}` };
  const proxy = Object.fromEntries(
    ['/annotations', '/x'].map((prefix) => [prefix, { target: apiTarget, changeOrigin: false }]),
  );
  return {
    base: '/sidebar/',
    plugins: [vue()],
    server: { port: 5173, strictPort: true, headers, proxy },
    preview: { port: 4173, strictPort: true, headers, proxy },
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          'popup-callback': 'popup-callback.html',
          'silent-renew': 'silent-renew.html',
        },
      },
    },
  };
});
