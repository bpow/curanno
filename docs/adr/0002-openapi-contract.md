# 0002. A hand-written OpenAPI document is the API contract

**Status:** Accepted

**Date:** 2026-10-29

## Context

We want a firm split between the server and every client, including our own sidebar and management site. The W3C Web Annotation Protocol fixes most resource shapes, but our search, access control, body profile and event endpoints are our own design. Without a contract that exists independently of the code, the server's behaviour becomes the de facto API, and clients end up depending on details nobody meant to promise.

Two approaches were considered: generating the OpenAPI document from server code, or writing it by hand and making the server conform to it.

## Decision

The OpenAPI document is written by hand and is the contract:

- The server binds its routes to the document and validates requests and responses against its schemas. The binding mechanism is decided by a Phase 0 spike and recorded in ADR 0011.
- Clients use a TypeScript client generated from the document (`openapi-typescript` with `openapi-fetch`, or similar). Hand-written fetch calls against the API are not accepted.
- Contract tests derived from the document run against the server in CI.
- The sidebar and the management site are ordinary API clients. They have no privileged path into the server and no endpoint that is not in the public document.

The document is versioned. Breaking changes require a major version bump.

## Consequences

- Clients can be built and tested against the document before the server exists, and the server cannot drift from it unnoticed.
- The API stays complete, because anything our own clients need must be in the document.
- Early iteration is slower: a schema change means editing the document, regenerating the client and updating the server rather than changing one function. The plan allows minor-version changes through Phase 4 to limit this.
- Two artefacts describe each endpoint, the document and the handler, and reviewers must check that they agree.

## References

- [Analysis note: API-first development](../web-annotation-replacement.md#api-first-development)
- [W3C Web Annotation Protocol](https://www.w3.org/TR/annotation-protocol/)
