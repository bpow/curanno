# Architecture decision records

An architecture decision record (ADR) captures one decision that shapes the system: the situation that called for it, what was decided, and what that costs us. ADRs are written when the decision is made and are not edited afterwards except to change their status. A decision that no longer holds is superseded by a new ADR, which links back to the old one. The open decisions listed in [the project plan](../web-annotation-plan.md) become ADRs here as each is settled.

## Conventions

- Files are named `NNNN-kebab-title.md`, numbered in order of creation. `0000-template.md` is the template.
- Status is one of **Proposed**, **Accepted** or **Superseded by NNNN**.
- Each ADR has a References line pointing to the analysis note, plan or external document that informed it.

## Index

| ADR                                              | Title                                                               | Status   |
| ------------------------------------------------ | ------------------------------------------------------------------- | -------- |
| [0001](0001-typescript-monorepo.md)              | TypeScript throughout, in one pnpm workspace                        | Accepted |
| [0002](0002-openapi-contract.md)                 | A hand-written OpenAPI document is the API contract                 | Accepted |
| [0003](0003-fastify-server.md)                   | Fastify as the server framework, with Ajv for all validation        | Accepted |
| [0004](0004-postgres-only-storage.md)            | Postgres as the only stateful dependency, accessed through Kysely   | Accepted |
| [0005](0005-external-oidc.md)                    | Authentication through an external OpenID Connect provider          | Accepted |
| [0006](0006-acl-in-sql.md)                       | Per-annotation access control as ACL rows enforced in SQL           | Accepted |
| [0007](0007-guest-sidebar-split.md)              | Guest/sidebar client split with the sidebar on our own origin       | Accepted |
| [0008](0008-framework-free-guest.md)             | The in-page guest is framework-free TypeScript                      | Accepted |
| [0009](0009-vue-sidebar-nuxt-management-site.md) | Vue for the sidebar, Nuxt for the management site                   | Accepted |
| [0010](0010-keep-original-selectors.md)          | Keep original selectors and represent anchoring failures explicitly | Accepted |
| [0011](0011-route-binding.md)                    | Bind routes to the OpenAPI document with fastify-openapi-glue       | Accepted |
| [0012](0012-code-point-offsets.md)               | Text offsets count Unicode code points                              | Accepted |
| [0013](0013-text-normalization-rules.md)         | Text normalization rules: whitespace, `br`, hidden content, scoping | Accepted |
| [0014](0014-document-identity.md)                | Document identity by a set of normalized URIs, with guarded canonical links and merging | Accepted |
| [0015](0015-single-container.md)                 | One annotation container, with search as the main query path        | Accepted |
| [0016](0016-structured-bodies.md)                | Structured bodies as an embedded `StructuredBody` validated by a profile registry | Accepted |
| [0017](0017-guest-base-and-highlight-rendering.md) | Build the guest's anchoring on the Hypothesis client's code and render highlights with the CSS Custom Highlight API | Accepted |
| [0018](0018-no-hypothesis-compatible-layer.md) | Do not build a Hypothesis-compatible API layer                      | Proposed |
| [0019](0019-sidebar-session-and-origin.md) | Sidebar sessions: public PKCE client, tokens in the sidebar origin, popup sign-in when framed | Accepted |
