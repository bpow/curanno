# Web annotation platform

An annotation system built on the [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) and [Protocol](https://www.w3.org/TR/annotation-protocol/), with structured annotation bodies, per-annotation access control, and a Hypothesis-style guest/sidebar client split. The project name and the `@scale` package scope are provisional.

- [Analysis and architecture](docs/web-annotation-replacement.md)
- [Project plan](docs/web-annotation-plan.md)
- [Architecture decision records](docs/adr/README.md)
- Specifications: [text model](docs/text-model.md), [document identity](docs/document-identity.md), [body profiles](docs/body-profiles.md), [OpenAPI document](apps/api/openapi.yaml)
- [Contributing](CONTRIBUTING.md)

## Layout

| Path                  | Package             | Role                                                       |
| --------------------- | ------------------- | ---------------------------------------------------------- |
| `packages/model`      | `@scale/model`      | Annotation types, text model, selectors, RPC message types |
| `packages/api-client` | `@scale/api-client` | Client generated from the OpenAPI document                 |
| `packages/guest`      | `@scale/guest`      | Framework-free in-page guest, its bundle and bookmarklet   |
| `apps/api`            | `@scale/api`        | Fastify server                                             |
| `apps/sidebar`        | `@scale/sidebar`    | Vue sidebar app ([README](apps/sidebar/README.md))         |
| `apps/pdf-viewer`     | `@scale/pdf-viewer` | PDF.js viewer page with the guest built in ([README](apps/pdf-viewer/README.md)) |
| `apps/web`            | `@scale/web`        | Nuxt management site ([README](apps/web/README.md))        |
| `deploy/`             |                     | Compose stack and Keycloak development realm               |
| `docs/`               |                     | Analysis, plan and ADRs                                    |

## Development

Requires Node 24 or later, pnpm 11, and podman (or docker) with the compose plugin.

```bash
pnpm install
podman compose up -d
cp .env.example .env
pnpm --filter @scale/api migrate
pnpm --filter @scale/api dev
pnpm check
```

`pnpm check` runs lint, formatting, type checks, tests, the dependency license check, the OpenAPI lint and the generated-client drift check, the same as CI. With `DATABASE_URL` set (as in `.env.example`) the tests also run the server suites against a scratch database: the W3C protocol, the OpenAPI contract test over every operation, the multi-principal access-control suite, search, documents, the event stream and authentication. Without it those tests are skipped.

Other scripts:

| Script                                    | Does                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @scale/api migrate`        | Applies `apps/api/migrations/*.sql` to `DATABASE_URL`                  |
| `pnpm --filter @scale/api dev`            | Builds and runs the API, restarting on changes to the build output     |
| `pnpm --filter @scale/sidebar dev`        | Runs the sidebar on port 5173, proxying the API (`apps/sidebar/README.md`) |
| `pnpm --filter @scale/sidebar e2e`        | Playwright test of the sidebar against Keycloak and the API           |
| `pnpm --filter @scale/sidebar e2e:guest`  | Playwright test of the bookmarklet, guest, sidebar and PDF viewer on corpus pages, API stubbed |
| `pnpm --filter @scale/pdf-viewer dev`     | Runs the PDF viewer on port 5174 (`apps/pdf-viewer/README.md`)        |
| `pnpm --filter @scale/web dev`            | Runs the management site on port 3001, proxying the API (`apps/web/README.md`) |
| `pnpm --filter @scale/web e2e`            | Playwright test of the management site against Keycloak and the API   |
| `pnpm openapi:lint`                       | Lints `apps/api/openapi.yaml` with Redocly                             |
| `pnpm api-client:generate`                | Regenerates `packages/api-client/src/schema.ts` from the OpenAPI document |
| `pnpm --filter @scale/guest bundle`       | Builds the guest bundle `packages/guest/build/guest.js`                 |
| `pnpm --filter @scale/guest bookmarklet -- --bundle-url URL --sidebar-origin ORIGIN` | Prints the bookmarklet for a deployed bundle and sidebar |
| `pnpm --filter @scale/guest dev [-- --sidebar-origin ORIGIN]` | Serves a sample page and the bundle, opens the fake or a real sidebar, prints a bookmarklet |
| `pnpm --filter @scale/guest test:browser` | Browser tests: text-model fixtures through the guest, RPC, hostile page |
| `pnpm --filter @scale/guest trial`        | Anchoring regression corpus; fails on a guessed must-not-match anchor  |
| `podman build -t annotations-api -f Dockerfile .` | Builds the API image                                           |
| `helm lint deploy/helm/annotations`       | Validates the Helm chart (see `deploy/helm/annotations/values.yaml`)   |

The compose stack provides Postgres on port 5432 and Keycloak on port 8080. Keycloak imports the `annotations-dev` realm from `deploy/keycloak/realm-dev.json`, with users `alice` (group `curators`) and `bob` (group `reviewers`), both with their username as password. The Keycloak admin console login is `admin` / `admin`. All of this is for local development only.

The API is configured entirely through environment variables; `.env.example` documents each one. A request with a bearer token from the configured issuer acts as that user, created on first sight with the groups in the token's `groups` claim; a request without a token acts as the `public` principal and may only read.

## Status

Phases 0 to 3 of the [project plan](docs/web-annotation-plan.md) are complete. The server in `apps/api` implements the W3C Web Annotation Protocol (one container with paging, `Prefer`, ETags and conditional requests), the `/x/` extensions (search over document identity and full text, per-annotation ACLs enforced in SQL, body profiles, documents, server-sent events over `LISTEN/NOTIFY`, users and groups), OIDC bearer-token authentication, a container image and a Helm chart.

Phase 4 is complete: the bookmarklet, guest, sidebar and API work together on HTML pages.

- The guest in `packages/guest` anchors on the text model (ADR 0012, 0013, 0017), passes the text-model fixtures in Chromium and the anchoring corpus with no guessed must-not-match anchors, draws highlights with the CSS Custom Highlight API (overlay fallback) without touching host text, re-anchors after DOM changes, and speaks the [guest/sidebar RPC protocol](docs/guest-sidebar-rpc.md) whose types live in `packages/model/src/rpc/`. The bundle and the bookmarklet generator are in place.
- The sidebar in `apps/sidebar` talks to the guest over that protocol (`src/guest/rpc.ts`): the document identity comes from the guest's report, anchor requests become highlights, highlights drive the cards, and a selection in the page becomes an annotation. It signs in through a popup when framed (ADR 0019), lists, creates, edits, replies to, shares and deletes annotations, edits TextualBody and structured bodies from the profile registry, follows the event stream, and sends a `frame-ancestors` policy. Run top-level it falls back to a development guest.
- Three suites cover the client: the guest's browser tests against its fake sidebar, the sidebar's Playwright test against Keycloak and the API, and the bookmarklet suite (`pnpm --filter @scale/sidebar e2e:guest`), which injects the built bundle into corpus pages the way the bookmarklet does, opens the built sidebar in the frame with the API stubbed, and runs the hostile-page test of success criterion 6 across the whole client. All three run in CI.

To try the bookmarklet locally: start the compose stack, migrate and run the API (above), then

```bash
pnpm --filter @scale/sidebar dev
pnpm --filter @scale/guest dev -- --sidebar-origin http://localhost:5173
```

Open <http://127.0.0.1:5180/> (or a corpus page under `/cases/`), press "Load the guest" or drag the printed bookmarklet to the bookmarks bar, and log in as `alice` in the popup. The local sidebar is plain http on `localhost`, so browsers embed it only from http pages on this machine (an https page blocks it as mixed content, and Chromium's local-network-access check stops pages elsewhere); other host origins also need `VITE_FRAME_ANCESTORS` to list them (`apps/sidebar/README.md`). A deployed sidebar on https has neither limit.

Phase 6, the management site in `apps/web`, is done ahead of Phase 5 since the API it needs was stable: sign-in against the compose Keycloak, users and groups administration with membership and roles (provider-managed groups shown read-only), a sharing panel over an annotation's ACL, annotation browsing and search over `/x/search`, component tests and a Playwright test that runs in CI. It is not yet in the Helm chart.

Remaining: PDFs, multi-frame support (one sidebar serving several guests), the security and accessibility reviews and operational readiness (Phase 5).
