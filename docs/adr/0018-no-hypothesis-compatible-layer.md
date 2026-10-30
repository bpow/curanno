# 0018. Do not build a Hypothesis-compatible API layer

**Status:** Accepted (2026-10-30, at release 1.0)

**Date:** 2026-10-30

## Context

The plan left one decision open until the end of Phase 3: whether to build a thin layer that speaks the Hypothesis `h` API, so that the unmodified Hypothesis client could run against this server and give an end-to-end system before the sidebar exists (Phase 4). The analysis note allowed for it as a testing aid, never as a product feature. At the end of Phase 3 the server implements the W3C protocol, search, access control and events, with a contract suite, a multi-principal ACL suite and an event-stream suite running against Postgres in CI; the sidebar has not started.

What "thin" would have to cover was reviewed against the Hypothesis client at the commit vendored in Phase 2:

- **Transport and shape.** The client reads `/api/` for its link index, then `/api/profile`, `/api/search`, `/api/annotations` (create, read, update, delete and flag), `/api/groups`, `/api/links` and `/api/profile/groups`. Every annotation goes over the wire in `h`'s JSON shape: `uri`, `text`, `tags`, `references` for replies, `permissions` as `read`, `update`, `delete` and `admin` lists of `acct:` and `group:` strings, a mandatory `group`, `document` metadata, and `user_info`. None of this maps directly onto the W3C model with per-annotation ACLs; a translation layer is a second data model, not a facade.
- **Authentication.** The client obtains tokens through `h`'s own OAuth endpoints (`/oauth/authorize` and `/oauth/token`, including refresh and revocation) or through a publisher grant token in page configuration. An OIDC provider does not speak that flow, so the layer would also be an authorization server bridging to OIDC. The analysis note names the page-supplied grant token as a shortcut this project must not reintroduce.
- **Serving the client.** The sidebar bundle, the boot script, `app.html` and the client's settings endpoint are served by `h`. Running the client means hosting its build and its configuration too.
- **Real-time.** The client uses a WebSocket protocol at `/ws` with its own message types, not server-sent events.
- **Text model.** The client stores UTF-16 offsets and its own `RangeSelector` shape (ADR 0012, ADR 0017). The layer would have to convert positions at the boundary against document text the server does not hold, or store non-conforming selectors. Either choice undermines the one text model the project exists to enforce.

A working estimate for a layer that drives the client's main paths is two to three weeks, written to be discarded in Phase 4.

## Decision

No Hypothesis-compatible layer is built. The server is exercised end to end by the Phase 3 suites (contract, access control, events) and by the generated client in `packages/api-client`; a visible end-to-end system arrives with the Phase 4 sidebar, whose first milestone should be a sidebar that lists and creates annotations against the server before the guest is wired in, so that the gap this layer would have filled is short.

Should the sidebar slip badly, this decision is revisited by weighing it against a minimal Vue sidebar skeleton over the generated client, which is Phase 4 work rather than a detour.

## Consequences

- No second data model, no OAuth bridge and no WebSocket endpoint to write and later delete; the W3C protocol and the `/x/` extensions remain the only API.
- No early demonstration with a familiar client. Stakeholders see the system working when the sidebar skeleton does, not before.
- The Hypothesis client's expectations do not leak into the server: group-mandatory annotations, `acct:` principals and UTF-16 offsets stay out of the data.
- The decision to skip migration of Hypothesis data (plan, section 2) is unaffected; a one-off import tool would use the text model's conversion helpers, not an API facade.

## References

- [Project plan: Decisions](../web-annotation-plan.md#4-decisions) and [Phase 3 decision point](../web-annotation-plan.md#phase-3-server-46-weeks)
- [Analysis note: Optional: a Hypothesis-compatible API layer](../web-annotation-replacement.md#optional-a-hypothesis-compatible-api-layer)
- [Hypothesis client](https://github.com/hypothesis/client) at `a7b7400d0d70`: `src/sidebar/services/api.ts`, `src/sidebar/services/oauth-auth.ts`, `src/sidebar/services/streamer.ts`
- ADR 0002, ADR 0005, ADR 0012, ADR 0017
