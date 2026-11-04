# Sidebar

The Vue 3 single-page application that the guest loads in an iframe from our origin (ADR 0007, ADR 0009). It holds the login session, makes every API call through `@curanno/api-client`, and renders all annotation content; the guest in the host page only ever sees selectors and annotation identifiers, over the [guest/sidebar RPC protocol](../../docs/guest-sidebar-rpc.md).

The build is Vite 7; Vite 8 (whose CSS minifier is MPL-2.0, admitted by ADR 0022 as build tooling) can follow when convenient.

State lives in Pinia stores (`src/stores`, `src/auth/store.ts`): the team knows it, it is the Vue default, and its stores are testable without a component.

## Running it

With the compose stack up, the database migrated and the API running (see the repository README):

```bash
pnpm --filter @curanno/sidebar dev
```

Open <http://localhost:5173/sidebar/?uri=https://example.test/sample-document> and log in as `alice` or `bob`. Run top-level like this the sidebar has no page, so it uses a development guest: the **Development guest** panel picks the document to annotate and turns typed text into a selection, so annotations can be created, edited, replied to, shared and deleted against the real API, and a second window on the same document shows them arriving live.

Inside a page, the guest loads the sidebar in its iframe and the sidebar talks to it over the RPC: the document comes from the guest's report of the page, never from the URL. To try that, keep the dev server running and start the guest's dev script pointed at it (`pnpm --filter @curanno/guest dev -- --sidebar-origin http://localhost:5173`; see the repository README).

The app lives under `/sidebar/`, the path the API serves it from in a deployment (ADR 0021), so development URLs are the deployed ones. The dev server proxies `/annotations` and `/x` to the API, so the sidebar talks to its own origin as the OpenAPI document assumes.

In a deployment, configuration is read at run time from `config.json` next to the app, which the API generates from its environment. The dev server has no `config.json`, so these build-time values apply (set them in `.env.local`), all optional, with defaults matching the compose stack:

| Variable                 | Default                                            | Meaning                                                      |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| `VITE_OIDC_ISSUER`       | `http://localhost:8080/realms/annotations-dev`     | OpenID Connect issuer                                        |
| `VITE_OIDC_CLIENT_ID`    | `annotations-sidebar`                              | Public client (Authorization Code with PKCE)                 |
| `VITE_API_URL`           | empty (same origin)                                | API origin, when it is not served under the sidebar's origin |
| `VITE_PDF_VIEWER_ORIGIN` | `http://localhost:5174`                            | The PDF viewer's origin (`pdfViewerOrigin`)                  |
| `VITE_API_PROXY_TARGET`  | `http://localhost:3000`                            | Where the dev and preview servers proxy the API to           |
| `VITE_FRAME_ANCESTORS`   | `'self' http://localhost:* http://127.0.0.1:*`     | `frame-ancestors` sent by the dev and preview servers        |

## Login and isolation

- Sign-in uses `oidc-client-ts` with the public client and PKCE. A top-level sidebar (development, tests) signs in through a redirect; a framed sidebar through a popup, because identity providers refuse to be framed. The popup returns only the authorization code to its opener on this origin; the token exchange and silent renewal happen in the sidebar frame.
- Tokens are kept in the sidebar origin's `sessionStorage` and attached as `Authorization: Bearer` by the API client. Nothing is stored in a cookie, nothing is written to `localStorage` but the sign-in state (PKCE verifier, no tokens), and nothing in the `Guest` interface carries a token, a body, a tag or a creator.
- The identity provider, client and API origin are build-time configuration. The host page supplies nothing (ADR 0007); the `uri` query parameter is read by the development guest only, and the RPC guest accepts a connection only from `window.parent`.
- `Content-Security-Policy: frame-ancestors …` limits which origins may embed the sidebar. The dev and preview servers send it from `VITE_FRAME_ANCESTORS`; the bookmarklet suite checks that an unlisted origin is refused.

### Serving in production

The built assets (`pnpm --filter @curanno/sidebar build`, output in `dist/`) are static. Whatever serves them must:

1. Send `Content-Security-Policy: frame-ancestors <origin> <origin> …` with the origins allowed to embed the sidebar on every response, `index.html` included. `frame-ancestors` is not honoured in a `<meta>` tag, so this has to be a response header. `X-Frame-Options` is unnecessary once it is set.
2. Serve the API under the same origin (`/annotations/`, `/x/`), or build with `VITE_API_URL` and enable CORS on the API with `ETag` exposed, which the API does not do today.
3. Keep `popup-callback.html` and `silent-renew.html` reachable at the sidebar's base URL; both are registered redirect URIs.
4. If a `script-src` directive is added, allow `'unsafe-eval'` or precompile the profile schemas: Ajv compiles JSON Schemas to functions at runtime.

The identity provider must list `<base>`, `<base>popup-callback.html` and `<base>silent-renew.html` as redirect URIs and the sidebar origin as a web origin; `deploy/keycloak/realm-dev.json` does this for the dev ports.

## Layout

| Path                             | Role                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/auth/`                      | User manager, Pinia auth store, popup and silent-renew entry points                           |
| `src/api/`                       | The one API client, problem-details handling, annotation reading and building helpers        |
| `src/stores/`                    | `annotations` (search, protocol writes with `If-Match`, event stream) and `profiles` (registry) |
| `src/events/`                    | `text/event-stream` parser and the reconnecting subscription with `Last-Event-ID`            |
| `src/profiles/`                  | Ajv-backed `ProfileRegistry` and the field list an editor is built from                      |
| `src/guest/`                     | The `Guest` interface, the RPC guest (`rpc.ts`) and the development guest (`fake.ts`)         |
| `src/components/`                | Cards, threads, editors, sharing panel, composer, development guest panel                    |
| `e2e/`                           | Playwright test over Keycloak, the API and the dev server; `e2e/guest/` the bookmarklet suite |

Replies are annotations whose target is the parent's IRI; they are threaded client-side. Each reply has its own ACL (ADR 0006), so a reply is visible to its author until shared. Edits and deletions fetch the annotation first and send its ETag as `If-Match`; a 412 is shown as a conflict with a reload action. Anchoring state is whatever the guest last reported for the annotation, falling back to the stored state; an orphaned or ambiguous annotation can be repaired from the current selection, which records `anchoring.repair` and leaves the original selectors in place (ADR 0010).

## Tests

```bash
pnpm vitest run --project sidebar       # component and transport tests (happy-dom), part of `pnpm test`
pnpm --filter @curanno/sidebar e2e        # Playwright; needs compose, a migrated database and the built API
pnpm --filter @curanno/sidebar e2e:guest  # Playwright; needs `pnpm build`, the guest bundle and `pnpm --filter @curanno/sidebar build`
```

The transport test (`src/guest/rpc.test.ts`) drives the RPC guest with hand-made window messages and a `MessageChannel`: connect, hello, document report, anchoring results, hover and activation, a connect from the wrong source, an unknown protocol version, a reconnecting guest, a second guest in another frame with its own document, the refusal of a document on another origin, and requests routed by document.

The end-to-end test starts the API from `apps/api/dist` (or reuses a running one) and the dev server, logs in as both development users in separate browser contexts, and checks that bob sees alice's annotation only after she shares it and then follows her edit and deletion live. CI runs it in the `sidebar-e2e` job with the Postgres service and a Keycloak container.

The bookmarklet suite (`e2e/guest/`, `playwright.guest.config.ts`) needs neither Keycloak nor Postgres: it serves corpus pages from the guest package, injects the built bundle the way the bookmarklet does, opens the built sidebar (`pnpm preview`) in the frame with a session seeded into `sessionStorage`, and answers the API from Playwright routes. Its `pdf.spec.ts` opens a corpus PDF in the built viewer app (`apps/pdf-viewer`, on its own preview origin) and checks the fingerprint identity, highlights on rendered and not-yet-rendered pages, and an annotation made from a selection in the text layer. Its `frames.spec.ts` runs the bookmarklet on a page (`e2e/guest/pages/`) with a same-origin and a cross-origin frame and checks that one sidebar serves all three documents. It checks that the sidebar takes the document from the guest's report, that anchor requests become highlights and highlights drive the cards, that a selection becomes an annotation (registering the document first), and, with a hostile script hooking every message channel in the page, that nothing but IRIs and selectors ever crosses and that an origin outside `frame-ancestors` cannot embed the sidebar (success criterion 6). CI runs it in the `bookmarklet-e2e` job.

## Guests

One sidebar serves every frame of the page that has a guest: the host frame's guest, which holds the sidebar, the same-origin frames the host injects the bundle into, and cross-origin frames whose pages load the guest themselves (our PDF viewer does). Each guest reports its own document; the store loads and follows every document, the list groups annotations by document when there are several, a selection is annotated on the document of the frame it was made in, and anchor requests go to the frames showing the document. A guest may report only documents on its own origin, except the configured PDF viewer origin (`pdfViewerOrigin` in `config.json`), which reports the PDF it shows (ADR 0021). The frame-by-frame mechanics are in [docs/guest-sidebar-rpc.md](../../docs/guest-sidebar-rpc.md), section 3.
