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
pnpm check
```

`pnpm check` runs lint, formatting, type checks, tests, the dependency license check, the OpenAPI lint and the generated-client drift check, the same as CI. With `DATABASE_URL` set (as in `.env.example`) the tests also apply the SQL migrations to a scratch database; without it those tests are skipped.

Other scripts:

| Script                                    | Does                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @scale/api migrate`        | Applies `apps/api/migrations/*.sql` to `DATABASE_URL`                  |
| `pnpm openapi:lint`                       | Lints `apps/api/openapi.yaml` with Redocly                             |
| `pnpm api-client:generate`                | Regenerates `packages/api-client/src/schema.ts` from the OpenAPI document |

The compose stack provides Postgres on port 5432 and Keycloak on port 8080. Keycloak imports the `annotations-dev` realm from `deploy/keycloak/realm-dev.json`, with users `alice` (group `curators`) and `bob` (group `reviewers`), both with their username as password. The Keycloak admin console login is `admin` / `admin`. All of this is for local development only.

## Status

Phase 1 of the [project plan](docs/web-annotation-plan.md), specification, is complete on paper: the text model with its fixture suite, the annotation types and schemas, the Postgres schema, document identity, body profiles and the OpenAPI document with a generated client. Phase 2 (guest trial) runs alongside it. Phase 3 (server) comes next; `apps/api` serves only a health route until then.
