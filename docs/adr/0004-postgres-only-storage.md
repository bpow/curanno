# 0004. Postgres as the only stateful dependency, accessed through Kysely

**Status:** Accepted

**Date:** 2026-10-29

## Context

Requirement 4 asks for stateless containers with few stateful dependencies. Hypothesis requires Elasticsearch alongside Postgres, which adds operational load. Our queries have three demanding parts: filtering by per-annotation permissions, full-text search, and querying inside JSON bodies and targets. These are naturally expressed in SQL. Real-time updates also need a change-notification channel.

For data access, ORMs (including Prisma) were considered against a typed query builder. The hard queries would be raw SQL under any ORM, and Prisma in particular works poorly with `tsvector` and JSONB operators.

## Decision

Postgres is the only stateful dependency:

- Bodies and targets are stored in JSONB columns.
- Full-text search uses Postgres `tsvector` indexes, not Elasticsearch.
- `LISTEN/NOTIFY` carries change notifications, which the server fans out to clients over server-sent events.
- Data access uses Kysely as a typed query builder over `pg`, with hand-written SQL for ACL filtering, full-text search and JSONB paths.
- Migrations are plain SQL files, run by Kysely's migrator or a standalone tool such as dbmate.

## Consequences

- Deployment needs a Postgres instance and nothing else. Backups and restores concern one system.
- Query performance at scale depends on index design, which must be done deliberately in Phase 1 and load-tested in Phase 5. Postgres full-text search is less flexible than Elasticsearch for relevance tuning and language analysis.
- `LISTEN/NOTIFY` is limited to one database and has a small payload size; a change of scale could call for a dedicated message bus later.
- Kysely gives type safety for ordinary queries but no model layer; raw SQL fragments need their own tests.
- Horizontal scaling of SSE connections requires each server instance to listen to Postgres itself, which is fine at our expected size.

## References

- [Analysis note: Server](../web-annotation-replacement.md#1-server)
