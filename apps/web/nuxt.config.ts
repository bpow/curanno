/**
 * The management site is an ordinary client of the public API (ADR 0009):
 * every request leaves the browser through `@scale/api-client` with the
 * user's own token. Nothing runs in Nuxt's server layer; a lint rule in the
 * root ESLint config fails on any file under apps/web/server.
 *
 * In development the API is proxied under the site's own origin, which is
 * how production serves the two as well (the OpenAPI document's server URL
 * is `/`). The proxy is a dev-server setting, not an application route.
 */
const apiProxyTarget = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000';

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
      titleTemplate: (title) =>
        title && title !== 'Annotation platform'
          ? `${title} · Annotation platform`
          : 'Annotation platform',
    },
  },
  runtimeConfig: {
    // Overridable at run time through NUXT_PUBLIC_API_BASE, NUXT_PUBLIC_OIDC_ISSUER
    // and NUXT_PUBLIC_OIDC_CLIENT_ID. Defaults match the compose stack.
    public: {
      apiBase: '',
      oidcIssuer: 'http://localhost:8080/realms/annotations-dev',
      oidcClientId: 'annotations-sidebar',
    },
  },
  // The landing page is public and server-rendered. Every other page needs
  // the user's token, which only the browser has, so those render there.
  routeRules: {
    '/': { ssr: true },
    '/**': { ssr: false },
  },
  nitro: {
    devProxy: {
      '/annotations': `${apiProxyTarget}/annotations`,
      '/x': `${apiProxyTarget}/x`,
    },
  },
});
