/**
 * The management site is an ordinary client of the public API (ADR 0009):
 * every request leaves the browser through `@curanno/api-client` with the
 * user's own token. Nothing runs in Nuxt's server layer; a lint rule in the
 * root ESLint config fails on any file under apps/web/server.
 *
 * In development the API is proxied under the site's own origin, which is
 * how production serves the two as well (the OpenAPI document's server URL
 * is `/`). The proxy is a dev-server setting, not an application route.
 */
const apiProxyTarget = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000';

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
const dev = process.env['NODE_ENV'] !== 'production';
const issuerSource = dev
  ? `${process.env['NUXT_PUBLIC_OIDC_ISSUER'] ?? 'http://localhost:8080/realms/annotations-dev'}/`
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
  devServer: { port: 3001 },
  // Every page has a language and a title (axe: html-has-lang, document-title).
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Annotation platform',
    },
  },
  runtimeConfig: {
    // Overridable at run time through NUXT_PUBLIC_API_BASE, NUXT_PUBLIC_OIDC_ISSUER,
    // NUXT_PUBLIC_OIDC_CLIENT_ID and NUXT_PUBLIC_PDF_VIEWER_URL. Defaults match the compose stack.
    public: {
      apiBase: '',
      oidcIssuer: 'http://localhost:8080/realms/annotations-dev',
      oidcClientId: 'annotations-sidebar',
      // The PDF viewer page, for the bookmarklet and the landing page (ADR 0021).
      pdfViewerUrl: 'http://localhost:5174/pdf/',
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
    },
  },
});
