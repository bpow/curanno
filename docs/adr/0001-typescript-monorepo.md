# 0001. TypeScript throughout, in one pnpm workspace

**Status:** Accepted

**Date:** 2026-10-29

## Context

The system has three parts that must agree exactly on how text is counted and how selectors are formed: the in-page guest, the server, and any tooling that imports annotations. The analysis note identifies drift between these as a leading risk, because a disagreement about offset units or whitespace handling shifts annotations silently rather than failing loudly. Hypothesis has a Python server and a JavaScript client, and that split is one source of duplicated logic in that project.

Python (Django or FastAPI) was considered for the server. It would be a reasonable choice for a Python-first team, but it would require a second implementation of the text model and makes long-lived connections for `LISTEN/NOTIFY` and server-sent events more awkward.

## Decision

The whole system is written in TypeScript and lives in one pnpm workspace:

| Package               | Role                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/model`      | Annotation types, JSON Schemas for body profiles, the text model, selector utilities, URL canonicalization, PDF fingerprinting, and guest/sidebar RPC message types |
| `packages/api-client` | TypeScript client generated from the OpenAPI document                                                                                                               |
| `packages/guest`      | The in-page script                                                                                                                                                  |
| `apps/api`            | The Fastify server                                                                                                                                                  |
| `apps/sidebar`        | The sidebar application                                                                                                                                             |
| `apps/web`            | The management site, added in release 1.1                                                                                                                           |

## Consequences

- The text model, selector handling and RPC types have one implementation, shared by every part that needs them. Drift within our own code becomes a matter of one package's tests.
- A single toolchain covers linting, type checking, testing and packaging.
- Third-party clients and imported data still need a published fixture suite, since they do not share our code.
- Hiring and onboarding assume TypeScript on the server as well as the client. Contributors who know only Python cannot work on the server.
- A monorepo needs discipline about package boundaries; the shared model package must not grow server-only or browser-only dependencies.

## References

- [Analysis note: Language and repository layout](../web-annotation-replacement.md#language-and-repository-layout)
- [Analysis note: Risks](../web-annotation-replacement.md#risks)
