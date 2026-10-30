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
| `packages/guest`      | `@scale/guest`      | Framework-free in-page script                              |
| `apps/api`            | `@scale/api`        | Fastify server                                             |
| `apps/sidebar`        | `@scale/sidebar`    | Vue sidebar app                                            |
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
| `pnpm openapi:lint`                       | Lints `apps/api/openapi.yaml` with Redocly                             |
| `pnpm api-client:generate`                | Regenerates `packages/api-client/src/schema.ts` from the OpenAPI document |
| `podman build -t annotations-api -f Dockerfile .` | Builds the API image                                           |
| `helm lint deploy/helm/annotations`       | Validates the Helm chart (see `deploy/helm/annotations/values.yaml`)   |

The compose stack provides Postgres on port 5432 and Keycloak on port 8080. Keycloak imports the `annotations-dev` realm from `deploy/keycloak/realm-dev.json`, with users `alice` (group `curators`) and `bob` (group `reviewers`), both with their username as password. The Keycloak admin console login is `admin` / `admin`. All of this is for local development only.

The API is configured entirely through environment variables; `.env.example` documents each one. A request with a bearer token from the configured issuer acts as that user, created on first sight with the groups in the token's `groups` claim; a request without a token acts as the `public` principal and may only read.

## Status

Phases 0 to 3 of the [project plan](docs/web-annotation-plan.md) are complete. The server in `apps/api` implements the W3C Web Annotation Protocol (one container with paging, `Prefer`, ETags and conditional requests), the `/x/` extensions (search over document identity and full text, per-annotation ACLs enforced in SQL, body profiles, documents, server-sent events over `LISTEN/NOTIFY`, users and groups), OIDC bearer-token authentication, a container image and a Helm chart. Phase 4 (guest, sidebar and end-to-end) comes next.
