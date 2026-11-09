# Contributing

## Setup

The project is a pnpm workspace written in TypeScript. You need Node 24 or later, pnpm and podman (or docker) with the compose plugin.

```bash
pnpm install
podman compose up -d --wait
pnpm test
```

`podman compose up` starts Postgres and a Zitadel instance and provisions its development client and users (`deploy/zitadel/provision.ts`). `pnpm test` runs every package's tests. To work without Zitadel, set `AUTH_MODE=embedded` as `.env.example` describes (Postgres is enough) and create a user with `pnpm --filter @curanno/api account create`; the browser tests run in that mode with `E2E_AUTH=embedded`. `pnpm lint` and `pnpm typecheck` run the checks CI runs.

## Branches and commits

- Branch from `main` using `feat/<slug>` (for example `feat/acl-search-filter`).
- One logical change per commit. Do not bundle unrelated fixes, and keep generated output (lockfiles, built bundles, regenerated clients) in its own commit after the hand-edited code.
- Subject lines are imperative and present tense, under 72 characters: "Add ACL join to search query".
- Pull requests should say what changed and why. Link the ADR or plan section when one applies.

## Decisions

Decisions that shape the system are recorded as architecture decision records in [docs/adr](docs/adr/README.md). If a change needs a new decision or overturns an old one, write the ADR first and include it in the pull request. Small implementation choices do not need an ADR; anything a future contributor would otherwise have to reverse-engineer does.

## Review

A pull request receives a first response within two working days. The response may be a review, a request for changes, or a note saying when a review will happen. Part of why this project exists is that contributions elsewhere went unanswered, so this is a commitment, not an aspiration.

## Versioned contracts

Two documents are contracts with people outside this repository:

- the OpenAPI document that defines the API
- the text model specification and its fixture suite in `packages/model`

Both carry a version. A change that would break an existing client or an existing implementation of the text model requires a major version bump and a note in the changelog. Additive changes bump the minor version.

## Third-party code

Code copied from another project must keep that project's license notice in the copied files, and the project must be listed in [docs/third-party-notices.md](docs/third-party-notices.md) with the version or commit it came from and the obligations its license imposes. New dependencies must use a license on the allowed list in that document; CI checks this.

## Tests

Changes to the server come with contract tests or ACL tests as appropriate. Changes to anchoring come with cases added to the regression corpus. Changes to the text model come with fixture vectors.
