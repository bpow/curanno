# 0009. Vue for the sidebar, Nuxt for the management site

**Status:** Accepted

**Date:** 2026-10-29

## Context

The team knows Vue. Two user-facing applications are planned: the sidebar, which runs in an iframe beside annotated pages, and a management site for users, groups, sharing and browsing. Nuxt was considered for both. The sidebar has no search engine or first-paint concerns, so server rendering offers it nothing, and Nuxt's server layer would blur the frontend/backend split that ADR 0002 establishes.

## Decision

- The **sidebar** is a Vue 3 single-page application built with Vite. It does not use Nuxt or server rendering.
- The **management site** is a Nuxt application, deferred to release 1.1. It uses `packages/api-client` and is an ordinary client of the public API. No business logic lives in Nuxt server routes; proxying or session handling are the only acceptable uses of the server layer, and each use must be justified in review.
- Any capability the management site needs that the API lacks is added to the OpenAPI document and the Fastify server first.

## Consequences

- The sidebar stays small and self-contained, with a build that is easy to serve as static assets from our origin.
- The management site gets Nuxt's routing, layouts and module ecosystem, and the team's Vue knowledge applies to both applications.
- Two build setups (Vite alone, and Nuxt) must be kept in step on Vue version and shared components.
- Nuxt's `server/` directory is a standing temptation to add endpoints outside the contract. Enforcing the rule depends on review, and a lint rule or CI check that fails on non-trivial server routes should be considered.
- Deferring the management site means early administration of users and groups happens through the API or the identity provider directly.

## References

- [Analysis note: Sidebar](../web-annotation-replacement.md#4-sidebar)
- [Analysis note: Management site](../web-annotation-replacement.md#5-management-site)
- ADR 0002
