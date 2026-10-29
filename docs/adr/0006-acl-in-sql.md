# 0006. Per-annotation access control as ACL rows enforced in SQL

**Status:** Accepted

**Date:** 2026-10-29

## Context

Requirement 3 asks for access control on individual annotations, enforced in search results as well as on single resources. Group-based permissions, as Hypothesis uses, do not give the fine-grained sharing we want. Relationship-based authorization services such as OpenFGA and SpiceDB were considered; they handle complex sharing rules well but make filtered listing harder, since each search result would need a separate check or a pre-fetched list of permitted identifiers.

## Decision

Access control is stored as ACL rows in Postgres, one per (annotation, principal, permission), and enforced inside the SQL queries themselves:

- Permissions are `read`, `update`, `delete` and `share`.
- Principals are users, groups and the pseudo-principals `authenticated` and `public`.
- The creator of an annotation receives all four permissions by default.
- Every read path, including search and the server-sent events stream, joins against the ACL rows and filters on `read` for the caller's principals.

An external authorization service may be adopted later if sharing rules outgrow this model, and would be the subject of a new ADR.

## Consequences

- Search stays a single query and permission filtering stays fast, because it happens where the data is.
- The model is simple to reason about and to test with several principals.
- Hierarchical or inherited permissions (a group within a group, or permissions on a document that apply to its annotations) are not expressed directly and would need expansion at write time or additional joins.
- Every new read path must include the ACL join. A missed join is a data leak, so the ACL test suite must cover each endpoint.
- Changing the permission set later means a migration touching every annotation's rows.

## References

- [Analysis note: Server](../web-annotation-replacement.md#1-server)
- [Analysis note: Build on Annotator](../web-annotation-replacement.md#build-on-annotator), on the per-action ACL idea
