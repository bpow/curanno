/**
 * The management site is an ordinary client of the public API (ADR 0009):
 * every request leaves the browser through `@curanno/api-client` with the
 * user's own token. Nothing runs in Nuxt's server layer; a lint rule in the
 * root ESLint config fails on any file under apps/web/server.
 *
 * In development the API and the sidebar's dev server are proxied under the
 * site's own origin, which is how production serves the three as well (the
 * OpenAPI document's server URL is `/`; ADR 0021). The proxy is a dev-server
 * setting, not an application route.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { devPort } from '../../dev-ports.ts';

const dev = process.env['NODE_ENV'] !== 'production';

/**
 * In development the issuer and the client default to OIDC_ISSUER and
 * OIDC_CLIENT_ID, from the environment, the repository .env or
 * deploy/zitadel/.bootstrap/oidc.env (written by the compose stack's
 * provisioner), so the API and the site name the same client. Only those are
 * read: the rest of .env configures the API. The ports come from
 * dev-ports.ts.
 */
function envFile(path: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL(path, import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}
function repositoryEnv(): Record<string, string | undefined> {
  if (!dev) return {};
  const own = { ...envFile('../../.env'), ...process.env };
  // The compose provisioner's file names a Zitadel client; the embedded issuer has its own (ADR 0028).
  if (own['AUTH_MODE'] === 'embedded') return own;
  return { ...envFile('../../deploy/zitadel/.bootstrap/oidc.env'), ...own };
}
const repoEnv = repositoryEnv();
// With the embedded issuer (ADR 0028) the issuer is the origin the site is served from.
const embedded = repoEnv['AUTH_MODE'] === 'embedded';
const oidcDefaults = embedded
  ? {
      issuer: (repoEnv['PUBLIC_URL'] ?? `http://localhost:${devPort('WEB_PORT')}`).replace(
        /\/$/,
        '',
      ),
      clientId: 'curanno',
    }
  : {
      issuer: repoEnv['OIDC_ISSUER'] ?? 'http://localhost:8080',
      clientId: repoEnv['OIDC_CLIENT_ID'] ?? '',
    };
const apiProxyTarget = process.env['API_PROXY_TARGET'] ?? `http://localhost:${devPort('PORT')}`;
const sidebarProxyTarget =
  process.env['SIDEBAR_PROXY_TARGET'] ?? `http://localhost:${devPort('SIDEBAR_PORT')}`;

/**
 * Sent with every page by Nitro. Scripts come from the site itself, plus
 * Nuxt's own inline bootstrap (its payload and preload scripts, which vary
 * per page, so neither a hash nor a nonce fits without a module for it:
 * docs/security-review.md, finding 19); inline styles are Nuxt's own;
 * connections go to the API on this origin and to the identity provider,
 * which is also the one frame source (silent renewal) and form target
 * (sign-in). The dev server's client needs eval and a websocket as well.
 *
 * The issuer is runtime configuration, so a built site names it as a
 * placeholder that Nitro fills in from NUXT_PUBLIC_OIDC_ISSUER when the
 * server starts (`envExpansion`); the policy and the configuration the
 * browser receives then name the same provider. The trailing slash allows
 * every path under the issuer, where the provider's endpoints are.
 */
const issuerSource = dev
  ? `${process.env['NUXT_PUBLIC_OIDC_ISSUER'] ?? oidcDefaults.issuer}/`
  : '{{NUXT_PUBLIC_OIDC_ISSUER}}/';
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${issuerSource}${dev ? ' ws: wss:' : ''}`,
    `frame-src ${issuerSource}`,
    `form-action 'self' ${issuerSource}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  // Everything is imported explicitly, so the components can be tested with
  // plain @vue/test-utils and the code reads the same with or without Nuxt.
  imports: { autoImport: false },
  // Every page has a language and a title (axe: html-has-lang, document-title).
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'CurAnno',
    },
  },
  runtimeConfig: {
    // Overridable at run time through NUXT_PUBLIC_API_BASE, NUXT_PUBLIC_OIDC_ISSUER,
    // NUXT_PUBLIC_OIDC_CLIENT_ID and NUXT_PUBLIC_PDF_VIEWER_URL. Defaults match the compose stack.
    public: {
      apiBase: '',
      oidcIssuer: oidcDefaults.issuer,
      oidcClientId: oidcDefaults.clientId,
      // The PDF viewer page, for the bookmarklet and the landing page (ADR 0021).
      pdfViewerUrl: `http://localhost:${devPort('PDF_VIEWER_PORT')}/pdf/`,
    },
  },
  // The landing page is public and server-rendered. Every other page needs
  // the user's token, which only the browser has, so those render there.
  routeRules: {
    '/': { ssr: true, headers: securityHeaders },
    '/**': { ssr: false, headers: securityHeaders },
  },
  nitro: {
    // Fills in the issuer in the security headers at startup (see above).
    experimental: { envExpansion: true },
    devProxy: {
      '/annotations': `${apiProxyTarget}/annotations`,
      '/x': `${apiProxyTarget}/x`,
      // The embedded issuer (ADR 0028); nothing answers these when the provider is external.
      '/oidc': `${apiProxyTarget}/oidc`,
      '/.well-known/openid-configuration': `${apiProxyTarget}/.well-known/openid-configuration`,
      '/sidebar/': { target: `${sidebarProxyTarget}/sidebar/`, ws: true },
    },
  },
});
