# 0020. The management site renders in the browser and uses no server routes

**Status:** Accepted

**Date:** 2026-10-30

## Context

ADR 0009 makes the management site a Nuxt application and an ordinary client of the public API, with proxying and session handling as the only acceptable uses of Nuxt's server layer, each to be justified in review. Building the site (plan, Phase 6) forced three concrete choices: where the user's session lives, what the server layer does, and how the site reaches the API.

Server-side sessions would give Nuxt a cookie and a privileged path to the API, the thing ADR 0002 and ADR 0009 exist to prevent, and would duplicate the session model the sidebar already has (ADR 0019).

## Decision

- The site signs in as the **same public OpenID Connect client** as the sidebar, with Authorization Code and PKCE, and keeps tokens in the browser only (`sessionStorage` of the site's origin). There is no server session and no cookie.
- **Nothing runs in Nuxt's server layer.** The landing page is server-rendered because it is public; every other page is rendered in the browser (`routeRules` with `ssr: false`), because only the browser holds the token. Route guards run in the browser and rely on the `isAdmin` flag `GET /x/me` reports. A rule in the root ESLint configuration fails on any file under `apps/web/server`, so the exception ADR 0009 allowed for review is closed rather than reviewed case by case.
- The site is **served under the API's origin**, as the sidebar is: the OpenAPI document's server URL is `/`, the dev server proxies `/annotations` and `/x` to the API, and production routes the same paths to the API in front of the site. The site's page routes therefore avoid those two prefixes (annotations are browsed under `/browse`). Serving the site on another origin would need CORS on the API, which is not configured; that would be a new decision.

## Consequences

- One session model for both clients, and the API stays the only place that knows who may do what.
- Pages other than the landing page have no server rendering, so there is nothing for search engines or for first paint beyond the application shell; for an administration site that is the right trade.
- The site cannot keep secrets from the browser, so there are none: the issuer and client are public configuration.
- A deployment must register the site's `/auth/callback` redirect URI with the provider and route the API paths in front of the site. The Helm chart does not yet ship the site; adding it means a second container and ingress rules, not a change to this decision.

## References

- ADR 0002, ADR 0009, ADR 0019
- [apps/web/README.md](../../apps/web/README.md)
