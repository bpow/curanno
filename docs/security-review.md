# Security review (Phase 5)

A review of the whole system against the threat model in the [analysis note](web-annotation-replacement.md) (requirements 3 and 5, "The architectural lesson from Hypothesis") and the protocol's threat section ([guest-sidebar-rpc.md](guest-sidebar-rpc.md), section 7), carried out on 2026-10-30 before release 1.0. It covers token handling in the sidebar and the site, access control on every API path including search and the event stream, JSON-LD context handling, input validation, the guest/page boundary, the response headers and the dependency audit. Each finding says what was done; the fixes are separate commits on the release branch, and the tests named stay in CI.

## Threat model, restated

- The annotated page and every script on it are hostile. They may read and alter the page, hook `postMessage` and `MessagePort`, impersonate the guest to the sidebar, and remove, hide or cover the sidebar frame. They must never obtain a token, an annotation body, a tag or an author, nor make the sidebar act as the user (requirement 5).
- Any authenticated user may be hostile towards other users: they must see and change only what the ACL rows allow, through every read path (requirement 3), and must not be able to escalate through groups, document identity or shared state.
- Anonymous callers see public annotations and nothing else.
- Documents the viewer renders (PDFs) are untrusted input to PDF.js.
- The identity provider is trusted for authentication; everything else the API decides.

## Findings

Severity is the reviewer's judgement of impact before the fix. "Fixed" names the change; "Accepted" records a decision not to change, with the reason.

### Access control

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | High | **A guest could name any document.** The sidebar accepted `document.report` for any URI, so a page at one origin could report a document on another and receive the anchor requests, quoted text included, of the user's annotations on it. | Fixed: the sidebar refuses a report whose URI is not on the guest's origin, except from the PDF viewer origin (ADR 0021); the host relays each frame's origin on `guest.connect`. Tests: `apps/sidebar/src/guest/rpc.test.ts`. Commit "Serve several frames from one sidebar and hold guests to their own origin". |
| 2 | High | **Group-name squatting.** Provider groups from the `groups` claim were matched by name alone and the name was unique across provider and API groups, so a group created through the API with a provider group's name received that group's members on their next login, and its creator administered it. | Fixed: a claim matches only groups owned by its issuer (migration 0008 makes names unique per owner); a claim can never join an API-created group. Test in `apps/api/src/auth/auth.test.ts`. |
| 3 | Medium | **Document identity poisoning.** `POST /x/documents` merged two existing documents when a page linked both (`rel=canonical`, DOI, `og:url`), irreversibly, on any authenticated user's say-so. | Fixed: documents already recorded as distinct are never merged by a client; the conflict is logged with the claimant for an operator ([document-identity.md](document-identity.md), section 6). A page may still attach *new* URIs to an existing document through its links, which is the feature; the annotations shown are still filtered by the ACL. |
| 4 | Medium | **Event streams kept stale permissions.** The subscriber's principals were fixed when the stream opened, for hours; a user removed from a group, or whose token had expired, kept receiving annotations shared with it. | Fixed: memberships are reloaded at every keepalive and the stream ends at the token's expiry (`apps/api/src/routes/events.ts`). Test in `events.test.ts`. |
| 5 | Medium | **Event replay without access control in SQL, and a livelock.** `Last-Event-ID` replay fetched up to 1000 events and ran two queries per event per subscriber; a client that could read none of them never advanced and replayed the same window on every reconnection. | Fixed: the replay query joins the ACL; skipped events and the newest id of a window are sent as id-only blocks, which the sidebar's parser now honours, so reconnection moves on. |
| 6 | Low | `share` alone could grant `update`, `delete` or `share` to `public` or `authenticated`, giving everyone write access. | Fixed: the pseudo-principals can be granted `read` only (422 otherwise). Test in `acl.test.ts`. A holder of `share` can still grant themselves `update` and `delete`: `share` is deliberately total control over sharing (ADR 0006), and the creator keeps every permission. |
| 7 | Info | Revocation is silent: a subscriber who loses `read` gets no event, so their sidebar shows the annotation until reload. | Accepted: telling a subscriber about an annotation they may no longer read would itself leak that it changed; the sidebar reloads on sign-in changes and page load. |

Reviewed and found sound: the protocol routes (every read joins the ACL; writes re-check `update`/`delete` on the same row; `If-Match` is required), container paging, every search filter (all narrow an ACL-filtered base query), reply creation (needs `read` on the parent), administrator checks on user and group routes, provider-managed groups being read-only through the API, profile writes (administrators only).

### Authentication and sessions

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 8 | Medium | **Email enumeration.** `GET /x/principals?q=` matched the query against email addresses and fell back to the email as the display name, so any user could list a domain's users and confirm addresses. | Fixed: matches on display names only, no email fallback. Test in `auth.test.ts`. |
| 9 | Low | Any user could read any other user's full group list (`GET /x/users/{id}`), and the creator id on every annotation made that cheap. | Fixed: memberships (and email) are returned to the user themself and to administrators. |
| 10 | Low | `GET /x/documents?uri=` and `/x/documents/{id}` answered anonymous callers with a document's title and every equivalent URI, intranet addresses and PDF fingerprints included. | Fixed: both need a token (OpenAPI and client regenerated). The sidebar reads documents only through search, which is unchanged. |
| 11 | Low | With `OIDC_ADMIN_GROUP` set, an administrator's `PATCH /x/users/{id} {isAdmin}` was overwritten from the claim within a minute, so the API lied. | Fixed: the patch answers 409 when the provider decides who administers. |
| 12 | Low | The verified-token cache was keyed by the raw token (fine, it is a secret) but grew without bound for a user minting many tokens. | Fixed: capped at 10 000 live entries, oldest re-verified first. A token revoked at the provider is honoured for at most 60 s or until its `exp`, whichever is sooner; documented in the operator guide. |
| 13 | Info | No tolerance for clock skew between the provider and the API. | Fixed: 30 s. |

Reviewed and found sound: token verification (jose rejects algorithm confusion through JWKS key matching; `iss`, `aud`/`azp`, `sub` and expiry are checked), the sidebar's and site's token handling (ADR 0019: `sessionStorage` of our origin only, `Authorization` header only, no cookies, popup sign-in returns only the code to the opener on the same origin, nothing in the guest protocol carries a token), anonymous access paths (the `public` principal only).

### Input validation and JSON-LD

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 14 | Low | A `Choice` body escaped profile validation: only the top-level body was checked, so a `StructuredBody` with an unregistered profile inside a `Choice` was stored, and its `profile` was invisible to the search filter. | Fixed: validation recurses into `Choice.items`. Test in `protocol.test.ts`. |
| 15 | Low | A `@context` nested in a body, target or extension property was stored and echoed, and a JSON-LD consumer would dereference it. The top-level `@context` was already the server's. | Fixed: a nested `@context` is rejected (422) at any depth. |
| 16 | Low | No size limits below Fastify's 1 MiB body cap; a long `TextualBody.value` hit the full-text index's row limit and became a 500. | Fixed: `maxLength` 100 000 on body text, a `maximum` on the container's `page`. |
| 17 | Info | An administrator-registered profile schema with a catastrophic regular expression would slow every write. | Accepted: administrators only; noted in the operator guide. |

The JSON-LD extension context that every annotation names was a placeholder IRI nobody served; it is now the deployment's own (`/x/context.jsonld`, `packages/model/src/annotation/context.ts`) and part of the contract test. Reviewed and found sound: Ajv is strict for bodies (`removeAdditional` off, no coercion, ADR 0011) and coercing only for parameters; prototype pollution is stopped by Fastify's JSON parser for both media types; every SQL value is parameterised and `LIKE` patterns are escaped; path parameters are validated as UUIDs and IRIs.

### The guest/page boundary

Reviewed against success criterion 6 with the automated hostile-page tests (`packages/guest/test/browser/isolation.test.ts`, `apps/sidebar/e2e/guest/hostile.spec.ts`), now also with several frames (`frames.spec.ts`) and the PDF viewer (`pdf.spec.ts`): no token, body, tag or creator reaches anything the page can observe; a hostile frame gets a port but is held to documents on its real origin (finding 1); a hostile top page can hand an embedded viewer a fake sidebar and learns the PDF's identity and the user's selections in it, nothing more ([guest-sidebar-rpc.md](guest-sidebar-rpc.md), section 7). The sidebar is served with `frame-ancestors` from the deployment's configuration (finding 19) and refuses to be framed elsewhere (tested). The PDF viewer runs on an origin of its own so that a PDF.js defect cannot reach the sidebar's storage (ADR 0021); PDF.js renders with forms and XFA off.

### Headers and serving

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 18 | Low | The API sent no security headers. | Fixed: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` when the public URL is https, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API responses, `Cache-Control: no-store` on bearer-authenticated responses (`apps/api/src/server.ts`). Test in `static.test.ts`. |
| 19 | Medium | `frame-ancestors` for the sidebar was a serving requirement left to the deployment (Phase 4 status note), so a deployment could ship without the clickjacking defence. | Fixed: the API image serves the sidebar with a full policy (`frame-ancestors` from `FRAME_ANCESTORS` plus the viewer origin, `script-src 'self' 'unsafe-eval'` for Ajv, provider origin for `connect-src`/`frame-src`/`form-action`), the viewer with its own, and the management site sends one from Nitro (`apps/web/nuxt.config.ts`). The site's policy allows inline scripts: Nuxt bootstraps each page with inline payload and preload scripts that differ per page, so a hash or nonce needs a module the site does not have; `script-src 'self'` still keeps third-party scripts out, and the site renders no user content unescaped. |
| 20 | Info | Prometheus metrics are world-readable on the API. | Accepted with a default: the chart keeps `/metrics` off the ingress (`ingress.metrics: false`); `METRICS_ENABLED=false` turns them off. |

### Dependencies

`pnpm audit --prod` on 2026-10-30 reported 27 advisories, all in the management site's Nuxt 4.3 tree: three critical (Nuxt DevTools RPC command execution; two in `simple-git`, a DevTools dependency), high ones in Nuxt's server (route-rule bypass, template injection, resource exhaustion). The site's server renders the landing page and serves the app in production, so these mattered. **Fixed:** Nuxt upgraded to 4.6, which also brings Vite 8 and its MPL-licensed CSS minifier, admitted as build tooling by ADR 0022. One low advisory remains: `deepmerge` 4.3.1 (prototype poisoning of returned objects) under Nitro's Rollup plugin; it runs at build time only and no fixed release exists yet. The API's own tree (Fastify, jose, Kysely, pg, Ajv, prom-client, @fastify/static) has no advisories. The license check passes with the three documented exceptions.

## Open items and accepted limits

- A page may attach its own URL to an existing document through a canonical link (finding 3 stops merges, not additions). A reader of that page then sees the public annotations of the linked document in a sidebar on the wrong page. Hypothesis has the same property; a stricter rule (same registrable domain) would break DOI and publisher links. Revisit if it is abused.
- The overlay highlight fallback and the browsers without the CSS Custom Highlight API are untested in CI (Chromium only).
- The guest exposes `window.__curannoGuest` with `toggleSidebar` and `destroy`; the page can do both by other means, so this grants nothing (ADR 0007).
- Rate limiting and connection limits are left to the ingress; the chart documents the SSE timeouts but sets no limits.
- The review was done by reading and by tests, not by penetration testing of a deployment. The operator guide lists what to check on a real cluster.
