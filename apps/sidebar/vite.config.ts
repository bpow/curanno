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
 *
 * VITE_OIDC_* fall back to the repository .env's OIDC_ISSUER and
 * OIDC_CLIENT_ID, which `deploy/zitadel/provision.ts` writes, so the API
 * and the sidebar name the same client.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const repo = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'OIDC_');
  for (const [name, fallback] of [
    ['VITE_OIDC_ISSUER', repo['OIDC_ISSUER']],
    ['VITE_OIDC_CLIENT_ID', repo['OIDC_CLIENT_ID']],
  ] as const) {
    if (!env[name] && fallback) process.env[name] = fallback;
  }
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
