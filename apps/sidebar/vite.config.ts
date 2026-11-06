import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';
import { devPort } from '../../dev-ports.ts';

/**
 * In development the API is proxied under the sidebar's own origin, which is
 * how production serves the two as well (the OpenAPI document's server URL
 * is `/`). `frame-ancestors` is the clickjacking defence from ADR 0007: only
 * the listed host origins may embed the sidebar. The app lives under
 * `/sidebar/`, where the API serves it in production (ADR 0021), so the
 * development URLs are the deployed ones. See README.md.
 *
 * VITE_OIDC_* fall back to OIDC_ISSUER and OIDC_CLIENT_ID from the
 * repository .env, then from deploy/zitadel/.bootstrap/oidc.env, which the
 * compose stack's provisioner writes, so the API and the sidebar name the
 * same client. The ports come from dev-ports.ts.
 */
function provisionedEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(
      readFileSync(new URL('../../deploy/zitadel/.bootstrap/oidc.env', import.meta.url), 'utf8'),
    );
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const repo = {
    ...provisionedEnv(),
    ...loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'OIDC_'),
  };
  for (const [name, fallback] of [
    ['VITE_OIDC_ISSUER', repo['OIDC_ISSUER']],
    ['VITE_OIDC_CLIENT_ID', repo['OIDC_CLIENT_ID']],
    ['VITE_PDF_VIEWER_ORIGIN', `http://localhost:${devPort('PDF_VIEWER_PORT')}`],
  ] as const) {
    if (!env[name] && fallback) process.env[name] = fallback;
  }
  const apiTarget = env['VITE_API_PROXY_TARGET'] || `http://localhost:${devPort('PORT')}`;
  const frameAncestors =
    env['VITE_FRAME_ANCESTORS'] || "'self' http://localhost:* http://127.0.0.1:*";
  const headers = { 'Content-Security-Policy': `frame-ancestors ${frameAncestors}` };
  const proxy = Object.fromEntries(
    ['/annotations', '/x'].map((prefix) => [prefix, { target: apiTarget, changeOrigin: false }]),
  );
  return {
    base: '/sidebar/',
    plugins: [vue()],
    server: { port: devPort('SIDEBAR_PORT'), strictPort: true, headers, proxy },
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
