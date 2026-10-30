# 0019. Sidebar sessions: public PKCE client, tokens in the sidebar origin, popup sign-in when framed

**Status:** Accepted

**Date:** 2026-10-30

## Context

ADR 0005 puts authentication with an external OpenID Connect provider and leaves open how the sidebar, which runs in an iframe on our origin inside pages we do not control (ADR 0007), holds its session. Three things constrain it: the provider's login page cannot be shown inside the sidebar frame, because providers forbid framing; cookies set by our origin inside a third-party iframe are partitioned or blocked by current browsers; and the host page must never be able to obtain or supply a credential.

Options considered were a server-side session with a cookie (fails in the iframe, and gives the API a second authentication path), a confidential client with a backend-for-frontend (a stateful component the Phase 3 server does not have), and the browser-only flow below.

## Decision

- The sidebar is a **public OIDC client** using Authorization Code with PKCE, through `oidc-client-ts`. The API accepts its access tokens as bearer tokens (ADR 0005); there is no sidebar session on the server.
- **Tokens stay in the sidebar origin**, in `sessionStorage`, and travel only as `Authorization` headers to the API. No cookie is set; the sign-in state (PKCE verifier, no tokens) is the only thing in `localStorage`, because the popup and silent-renew windows need it.
- A **framed sidebar signs in through a popup** window on our origin; the popup hands back only the authorization code, to its opener on the same origin, and the sidebar frame exchanges it. A **top-level sidebar** (development, tests) uses a redirect. Renewal uses the refresh token or a hidden iframe on our origin; sign-out mirrors sign-in and always forgets the tokens locally.
- The **API is served under the sidebar's origin** (`/annotations/`, `/x/`), as the OpenAPI document's server URL `/` states. The dev server proxies; production serving does the same. Cross-origin API access is possible through a build-time setting but is not the supported arrangement.
- The issuer, client and API origin are build-time configuration. Nothing from the host page or the guest selects them.

## Consequences

- No cookies and no server session means no CSRF surface and no cross-site cookie trouble in the iframe; the token is unreachable from the host page because the sidebar frame is another origin.
- Sign-in from a framed sidebar needs a user gesture that opens a popup; popup blockers and the provider's own cookies still apply inside the popup. A redirect would be simpler but cannot work inside the frame.
- `sessionStorage` is per tab: each new tab signs in again (silently, when the provider still has a session). This is the trade for not sharing tokens across tabs.
- Silent renewal in a hidden iframe depends on the provider accepting third-party cookies when the sidebar is framed; the refresh token path does not, so the development realm keeps refresh tokens enabled and production providers should too.
- The identity provider must register three redirect URIs per sidebar base URL (the base, `popup-callback.html`, `silent-renew.html`). Keycloak accepts only a trailing wildcard, so the dev realm lists the dev and preview ports explicitly.
- Serving the API under the same origin keeps CORS out of the API and `ETag` visible to the client without `Access-Control-Expose-Headers`.

## References

- ADR 0005, ADR 0007, ADR 0009
- [apps/sidebar/README.md](../../apps/sidebar/README.md), "Login and isolation"
- [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/)
- [oidc-client-ts](https://github.com/authts/oidc-client-ts)
