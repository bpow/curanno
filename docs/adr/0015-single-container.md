# 0015. One annotation container, with search as the main query path

**Status:** Accepted

**Date:** 2026-10-29

## Context

The W3C Web Annotation Protocol organises annotations into containers: an LDP Basic Container that lists its annotations with paging and answers `Prefer` headers, and to which clients `POST` new annotations. The protocol does not say how many containers a server has or what each contains. Options were a container per user, per group, per document, or a single container with the platform's own search endpoint for every selective query.

Per-document containers match how clients work (show me this page's annotations) but need a container to be created or discovered before the first annotation, and document identity (ADR 0014) means a document's identity can change by merging. Per-user or per-group containers duplicate what access control already expresses.

## Decision

The server exposes one container, `/annotations/`:

- `GET /annotations/` pages over every annotation the caller may read, newest first, with the protocol's paging, `iris` and `Prefer` behaviour. An optional `target` query parameter restricts the listing to a document and its equivalent URIs, so protocol-only clients can still fetch a page's annotations.
- `POST /annotations/` creates an annotation; the document is derived from the target's `source` and the metadata the client registered through `/x/documents`.
- `GET /x/search` is the main query path for our own clients: by document, text, motivation, purpose, profile, creator, anchoring state, parent and date, with offset paging and a total count. Results are filtered by read permission in SQL (ADR 0006).

## Consequences

- Protocol conformance is met with the least surface: one container to test for paging, `Prefer` and conditional requests.
- Nothing has to exist before the first annotation on a page, and merging documents moves nothing between containers.
- The container listing is of limited use on a large instance without `target`; our clients use search. Third-party protocol clients get the `target` filter as a small, documented extension.
- Container membership does not express sharing or grouping; the ACL does. Any future need for a client-visible grouping (collections, projects) is a new endpoint, not a container structure.

## References

- [W3C Web Annotation Protocol, Annotation Containers](https://www.w3.org/TR/annotation-protocol/#annotation-containers)
- [apps/api/openapi.yaml](../../apps/api/openapi.yaml)
- ADR 0002, ADR 0006, ADR 0014
