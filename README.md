# CurAnno

An annotation system built on the [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) and [Protocol](https://www.w3.org/TR/annotation-protocol/), with structured annotation bodies, per-annotation access control, and a Hypothesis-style guest/sidebar client split. The project is named CurAnno, for curation annotations; its packages use the `@curanno` scope.

- [Analysis and architecture](docs/web-annotation-replacement.md)
- [Project plan](docs/web-annotation-plan.md)
- [Architecture decision records](docs/adr/README.md)
- Specifications: [text model](docs/text-model.md), [document identity](docs/document-identity.md), [body profiles](docs/body-profiles.md), [OpenAPI document](apps/api/openapi.yaml)
- [Contributing](CONTRIBUTING.md)

## Layout

| Path                  | Package             | Role                                                       |
| --------------------- | ------------------- | ---------------------------------------------------------- |
| `packages/model`      | `@curanno/model`      | Annotation types, text model, selectors, RPC message types |
| `packages/api-client` | `@curanno/api-client` | Client generated from the OpenAPI document                 |
| `packages/guest`      | `@curanno/guest`      | Framework-free in-page guest, its bundle and bookmarklet   |
| `apps/api`            | `@curanno/api`        | Fastify server                                             |
| `apps/sidebar`        | `@curanno/sidebar`    | Vue sidebar app ([README](apps/sidebar/README.md))         |
| `apps/pdf-viewer`     | `@curanno/pdf-viewer` | PDF.js viewer page with the guest built in ([README](apps/pdf-viewer/README.md)) |
| `apps/extension`      | `@curanno/extension`  | Chromium extension running the guest in every frame ([README](apps/extension/README.md)) |
| `apps/web`            | `@curanno/web`        | Nuxt management site ([README](apps/web/README.md))        |
| `deploy/`             |                     | Helm chart, and Zitadel's compose setup, provisioning and chart values |
| `docs/`               |                     | Analysis, plan and ADRs                                    |

## Development

Requires Node 24 or later, pnpm 11, and podman (or docker) with the compose plugin.

```bash
pnpm install
podman compose up -d --wait
cp .env.example .env
pnpm --filter @curanno/api migrate
pnpm --filter @curanno/api dev
pnpm check
```

`pnpm check` runs lint, formatting, type checks, tests, the dependency license check, the OpenAPI lint and the generated-client drift check, the same as CI. With `DATABASE_URL` set (as in `.env.example`) the tests also run the server suites against a scratch database: the W3C protocol, the OpenAPI contract test over every operation, the multi-principal access-control suite, search, documents, the event stream and authentication. Without it those tests are skipped.

Other scripts:

| Script                                    | Does                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @curanno/api migrate`        | Applies `apps/api/migrations/*.sql` to `DATABASE_URL`                  |
| `pnpm --filter @curanno/api dev`            | Builds and runs the API, restarting on changes to the build output     |
| `pnpm --filter @curanno/sidebar dev`        | Runs the sidebar on port 5173, proxying the API (`apps/sidebar/README.md`) |
| `pnpm --filter @curanno/sidebar e2e`        | Playwright test of the sidebar against Zitadel and the API            |
| `pnpm --filter @curanno/sidebar e2e:guest`  | Playwright test of the bookmarklet, guest, sidebar and PDF viewer on corpus pages, API stubbed |
| `pnpm --filter @curanno/pdf-viewer dev`     | Runs the PDF viewer on port 5174 (`apps/pdf-viewer/README.md`)        |
| `pnpm --filter @curanno/extension build`    | Builds the unpacked extension into `apps/extension/dist` (`apps/extension/README.md`) |
| `pnpm --filter @curanno/extension test:browser` | Playwright test of the built extension in Chromium against the fake sidebar |
| `pnpm --filter @curanno/web dev`            | Runs the management site on port 3001, proxying the API (`apps/web/README.md`) |
| `pnpm --filter @curanno/web e2e`            | Playwright test of the management site against Zitadel and the API    |
| `pnpm openapi:lint`                       | Lints `apps/api/openapi.yaml` with Redocly                             |
| `pnpm api-client:generate`                | Regenerates `packages/api-client/src/schema.ts` from the OpenAPI document |
| `pnpm --filter @curanno/guest bundle`       | Builds the guest bundle `packages/guest/build/guest.js`                 |
| `pnpm --filter @curanno/guest bookmarklet -- --bundle-url URL --sidebar-origin ORIGIN` | Prints the bookmarklet for a deployed bundle and sidebar |
| `pnpm --filter @curanno/guest dev [-- --sidebar-origin ORIGIN]` | Serves a sample page and the bundle, opens the fake or a real sidebar, prints a bookmarklet |
| `pnpm --filter @curanno/guest test:browser` | Browser tests: text-model fixtures through the guest, RPC, hostile page |
| `pnpm --filter @curanno/guest trial`        | Anchoring regression corpus; fails on a guessed must-not-match anchor  |
| `pnpm load:seed -- [--annotations N ...]`  | Fills `DATABASE_URL` with load-test data at representative volumes (`docs/performance.md`) |
| `pnpm load:run -- [--out results.json]`   | Runs the load test against that database and explains the search queries |
| `podman build -t annotations-api -f Dockerfile .` | Builds the API image                                           |
| `helm lint deploy/helm/annotations --set config.oidcClientId=dev` | Validates the Helm chart (see `deploy/helm/annotations/values.yaml`)   |

The compose stack provides Postgres on port 5432 and Zitadel on port 8080 (issuer `http://localhost:8080`, its login UI under `/ui/v2/login`), keeping its own `zitadel` database in the same Postgres. Its `zitadel-provision` service runs `deploy/zitadel/provision.ts --dev-users` on every `up`: it creates the client and the users `alice` and `bob`, both with their username as password, and writes the generated client id to `deploy/zitadel/.bootstrap/oidc.env`. The API, the sidebar's and the site's dev servers and the end-to-end tests fall back to that file when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are not set in the environment or `.env`. The Zitadel console is at <http://localhost:8080/ui/console> as `zitadel-admin@annotations-dev.localhost` / `Password1!`. All of this is for local development only; see [deploy/zitadel/README.md](deploy/zitadel/README.md).

The API is configured entirely through environment variables; `.env.example` documents each one. A request with a bearer token from the configured issuer acts as that user, created on first sight with the groups in the token's `groups` claim; a request without a token acts as the `public` principal and may only read.

## Status

Release 1.0: Phases 0 to 6 of the [project plan](docs/web-annotation-plan.md) are complete; the plan's Phase 5 status note records how each success criterion was met and the limits that stand.

- **Server** (`apps/api`): the W3C Web Annotation Protocol (one container with paging, `Prefer`, ETags and conditional requests) and the `/x/` extensions (search over document identity and full text, per-annotation ACLs enforced in SQL, body profiles, documents, server-sent events over `LISTEN/NOTIFY`, users and groups, the JSON-LD extension context), OIDC bearer-token authentication, structured logs with request ids, Prometheus metrics, liveness and readiness probes, and the static clients served from the same process (ADR 0021).
- **Clients**: the guest in `packages/guest` anchors on the text model (ADR 0012, 0013, 0017) in HTML pages and in PDF.js text layers, draws highlights with the CSS Custom Highlight API, re-anchors after changes, and speaks the [guest/sidebar RPC protocol](docs/guest-sidebar-rpc.md), one guest per frame with the host frame relaying the others. The sidebar in `apps/sidebar` serves every frame's document, follows the event stream live, signs in through a popup when framed (ADR 0019), and passes the axe checks. The PDF viewer in `apps/pdf-viewer` opens PDFs by URL or from a file and identifies them by fingerprint. The management site in `apps/web` administers users, groups and sharing.
- **Assurance**: the contract test over every operation, the multi-principal ACL suite, the event-stream tests, the backup and restore test, a live OIDC test against Zitadel, the text-model fixtures through the guest, the anchoring corpus gate, the bookmarklet suite (HTML, PDF, frames, hostile page, accessibility), the sidebar and site Playwright suites, both images and the chart, all in CI. The [security review](docs/security-review.md) records the findings and their fixes.
- **Documentation**: [user guide](docs/user-guide.md), [operator guide](docs/operator-guide.md), [accessibility](docs/accessibility.md), the specifications and the ADRs.

To try the bookmarklet locally: start the compose stack, migrate and run the API (above), then

```bash
pnpm --filter @curanno/sidebar dev
pnpm --filter @curanno/guest dev -- --sidebar-origin http://localhost:5173
```

Open <http://127.0.0.1:5180/> (or a corpus page under `/cases/`), press "Load the guest" or drag the printed bookmarklet to the bookmarks bar, and log in as `alice` in the popup. For a PDF, `pnpm --filter @curanno/pdf-viewer dev` and open <http://localhost:5174/pdf/>. The local sidebar is plain http on `localhost`, so browsers embed it only from http pages on this machine (an https page blocks it as mixed content, and Chromium's local-network-access check stops pages elsewhere); other host origins also need `VITE_FRAME_ANCESTORS` to list them (`apps/sidebar/README.md`). A deployed sidebar on https has neither limit.

Open after 1.0: a manual screen-reader pass per [accessibility.md](docs/accessibility.md), a load test of the ACL-filtered search at representative volumes, and deployment to a real cluster (the chart is lint- and template-checked and the images run; no cluster was available during development).
