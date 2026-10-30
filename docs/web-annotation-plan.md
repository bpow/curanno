# Web Annotation Platform: Project Plan

This plan turns the analysis in [web-annotation-replacement.md](web-annotation-replacement.md) into a sequence of work with deliverables, exit criteria and decision points. The analysis note remains the record of *why*; this document is the record of *what, in what order, and how we know it's done*.

## 1. Purpose

Build an annotation platform for our own use that implements the W3C Web Annotation Data Model and Protocol, supports structured annotation bodies and per-annotation access control, and deploys as stateless containers against Postgres. Hypothesis serves many communities well; our needs have diverged from its focus, and this project fills that gap rather than competing with it.

## 2. Scope

### In scope for release 1.0

- Annotating HTML pages, including pages that change after annotation
- Annotating PDFs through a PDF.js-based viewer
- W3C Web Annotation Protocol API with JSON-LD, including structured bodies validated against registered profiles
- Per-annotation access control for read, update, delete and share, enforced in search as well as on single resources
- Login through an external OpenID Connect provider
- Sidebar client injected by a bookmarklet
- Real-time updates to open sidebars for annotations the viewer may read
- Postgres full-text search over annotation text
- Container images and a Helm chart

### Deferred beyond 1.0

- Management site for users, groups and sharing (release 1.1)
- Browser extension packaging
- Media Fragment selectors for audio and video
- Ebook and other non-HTML, non-PDF document types
- Hypothesis-compatible API layer (built only if it shortens the path to end-to-end testing; see Phase 3)
- Migration of existing Annotator or Hypothesis data

### Out of scope

- A built-in account system or password storage
- Backwards compatibility with the Hypothesis API or data format as a product feature
- Elasticsearch or any second stateful service

## 3. Success criteria

Release 1.0 is done when all of the following hold:

1. A user can log in through the identity provider, annotate a public web page and a PDF from the bookmarklet, and see the annotation from another browser.
2. The server passes the contract test suite generated from the OpenAPI document, and the OpenAPI document covers the W3C protocol's required behaviour (containers, paging, `Prefer`, ETags and conditional requests).
3. A structured body with a registered profile is accepted, and the same body with a schema violation is rejected with a useful error.
4. A search for annotations on a document returns only annotations the caller may read, verified by an automated test with several principals.
5. On the anchoring regression corpus (Phase 2), the shipped guest re-anchors at least as well as the Hypothesis client, with no silent wrong anchors on the cases marked "must not match".
6. No credentials, tokens or annotation bodies are observable from the annotated page's JavaScript, verified by an automated test that runs a hostile script in the host page.
7. The system deploys to a Kubernetes cluster from the Helm chart with Postgres as the only stateful dependency.

## 4. Decisions

### Recorded

| Area | Decision | Source |
|---|---|---|
| Language | TypeScript throughout, one pnpm workspace | Analysis note, "Language and repository layout" |
| API contract | Hand-written OpenAPI document; server binds routes to it; clients use a generated client; contract tests in CI | "API-first development" |
| Server framework | Fastify, routes bound to the OpenAPI document, Ajv for all validation | "Server" |
| Data access | Kysely over `pg`, hand-written SQL for ACL filtering, search and JSONB; plain SQL migrations | "Server" |
| Storage | Postgres only: JSONB, full-text search, `LISTEN/NOTIFY` | "Server" |
| Real-time transport | Server-sent events | "Server" |
| Authentication | OpenID Connect against an external provider | "Server" |
| Authorization | ACL rows (annotation, principal, permission) enforced in SQL | "Server" |
| Client architecture | Guest/sidebar split; sidebar in an iframe on our origin; guest receives only selectors and IDs | "The architectural lesson from Hypothesis" |
| Guest | Framework-free TypeScript | "In-page guest" |
| Sidebar | Vue 3 with Vite, single-page app | "Sidebar" |
| Management site | Nuxt, as an ordinary API client with no business logic in server routes | "Management site" |
| Anchoring failures | Keep original selectors; never silently regenerate | "Selectors and the text model" |
| Offset unit | Unicode code points of NFC text, converted at the guest boundary | [ADR 0012](adr/0012-code-point-offsets.md) |
| Text normalization | Collapse whitespace, `<br>` is a line feed, no block separators, hidden and excluded content omitted, selectors scoped to body or the refined element | [ADR 0013](adr/0013-text-normalization-rules.md) |
| Document identity | A set of normalized URIs per document; canonical, DOI, Dublin Core, `og:url`, shortlink and PDF fingerprint identifiers with guards; overlapping sets merge | [ADR 0014](adr/0014-document-identity.md) |
| Container structure | One container `/annotations/`, with `/x/search` as the main query path | [ADR 0015](adr/0015-single-container.md) |
| Structured bodies | Embedded `StructuredBody` with a `profile` IRI, validated against a registry of JSON Schemas | [ADR 0016](adr/0016-structured-bodies.md) |
| Route binding | `fastify-openapi-glue` bound to the OpenAPI document; Ajv with `removeAdditional` disabled so JSON-LD extension properties round-trip | [ADR 0011](adr/0011-route-binding.md) |
| Guest base | Hypothesis client anchoring code, vendored and ported to the text model; quote matching with a minimum score | [ADR 0017](adr/0017-guest-base-and-highlight-rendering.md), Phase 2 trial |
| Highlight rendering | CSS Custom Highlight API, overlay elements as the fallback; never wrap text | [ADR 0017](adr/0017-guest-base-and-highlight-rendering.md), Phase 2 trial |

### Open, with owner phase

| Decision | Options | Decide in |
|---|---|---|
| Hypothesis-compatible layer | Build to test end to end early, or skip and rely on the bookmarklet | End of Phase 3, based on sidebar progress |

Each decision, once made, is recorded as an architecture decision record under `docs/adr/`.

## 5. Phases

Phases 1 and 2 run in parallel. Everything else is sequential, though Phase 6 can start as soon as the API it needs is stable. Durations are indicative, assume one to two developers, and exist to show relative size rather than to commit dates.

### Phase 0: Foundations (1–2 weeks)

**Deliverables**

- pnpm workspace with the packages from the analysis note, shared TypeScript, lint and test configuration
- CI running lint, type checks, unit tests and license checks on every change
- `docs/adr/` with the recorded decisions above written up
- `CONTRIBUTING.md` with review expectations and a stated review turnaround
- License inventory of code we intend to copy or depend on, with the notices we must keep
- Local development environment: `compose.yaml` with Postgres and a Keycloak instance for OIDC, runnable with podman
- Spike: bind one Fastify route to a toy OpenAPI document both ways and pick the binding mechanism

**Exit criteria:** a contributor can clone, run the stack locally, and get a green CI run on an empty change.

### Phase 1: Specification (3–4 weeks, parallel with Phase 2)

**Deliverables**

- **Text model specification** in `packages/model`: offset unit, whitespace normalization, `<br>`, hidden and excluded content, offset scoping. Published alongside a fixture suite of test vectors (HTML input, expected normalized text, expected selectors for marked ranges) that any implementation can run.
- **Data model**: Postgres schema for annotations, targets, bodies, documents and equivalent URIs, principals, groups and ACL rows. JSONB for bodies and targets, `tsvector` columns for search.
- **ACL model**: permissions `read`, `update`, `delete`, `share`; principals are users, groups and the pseudo-principals `authenticated` and `public`; creator receives all permissions by default; search filters on `read`.
- **Document identity rules**: URL canonicalization, handling of `rel=canonical` and `dc.identifier`, PDF fingerprinting, and how equivalent URIs are stored and queried.
- **Body profile registry**: how a JSON Schema is registered against a `purpose` or profile URI; at least one structured profile defined as proof.
- **OpenAPI document** covering the W3C protocol endpoints plus our extensions under a distinct prefix: search, ACL, body profiles, events (SSE), and the user and group endpoints the management site will need.
- Generated `packages/api-client` from the OpenAPI document, with generation checked in CI.

**Exit criteria:** text model fixtures pass against a reference implementation in `packages/model`; the OpenAPI document validates and generates a client; both reviewed and tagged `spec-0.1`.

### Phase 2: Guest trial (2–3 weeks, parallel with Phase 1)

**Deliverables**

- **Anchoring regression corpus**: a saved set of real pages and PDFs, each with annotations and one or more edited versions. Cases include overlapping and discontiguous selections, DOM rewrites by a framework, hidden and excluded text, non-Latin text and emoji, long documents, nested scrolling, and cases marked "must not match" where re-anchoring should report an orphan rather than guess.
- Harness that runs a candidate guest against the corpus and reports anchored, orphaned and wrong-anchor counts.
- Results for: Recogito with its default re-anchoring; Recogito with a Hypothesis-style quote-matching fallback through `selectorReviveFn` and our own W3C adapter; the Hypothesis guest code copied in.
- Keyboard and screen-reader check of each candidate's highlights and selection handling.
- ADR recording the choice and the highlight-rendering approach.

**Exit criteria:** ADR accepted. The corpus and harness become a permanent regression suite for the chosen guest.

### Phase 3: Server (4–6 weeks)

**Deliverables**

- Fastify server bound to the OpenAPI document, with Ajv validating requests, responses and body profiles
- Migrations and Kysely types for the Phase 1 schema
- W3C protocol: create, read, update, delete, containers with paging, `Prefer` handling, ETags and `If-Match`
- OIDC login flow and token validation
- ACL enforcement in every read path, including search, with a multi-principal test suite
- Search endpoint over document identity, text and body fields, using Postgres full-text search
- `LISTEN/NOTIFY` to SSE bridge, filtered by the subscriber's read permissions
- Container image, Helm chart, and deployment to a development cluster
- Contract tests from the OpenAPI document running in CI against a real Postgres

**Decision point at exit:** if the sidebar is not yet usable, decide whether a thin Hypothesis-compatible layer is worth building to exercise the server with the existing Hypothesis client. Keep it in a separate package if built.

**Exit criteria:** success criteria 2, 3, 4 and 7 met against the development cluster.

### Phase 4: Guest, sidebar and end-to-end (4–6 weeks)

**Deliverables**

- `packages/guest` built on the Phase 2 choice, producing and consuming selectors exactly per the text model, passing the fixture suite and the anchoring regression corpus
- postMessage RPC protocol between guest and sidebar, with message types in `packages/model`, modelled on Hypothesis's `frame-sync`
- Sidebar in Vue: login, list annotations for the current document, create, edit and delete, reply, editors for TextualBody and the registered structured profile, sharing controls over the ACL endpoints, orphan display and manual repair
- Bookmarklet that injects the guest and opens the sidebar
- Clickjacking and isolation defenses: frame-ancestors policy on the sidebar, no page-supplied configuration that grants login, and the hostile-page test from success criterion 6
- End-to-end tests with Playwright over the bookmarklet, sidebar and server on pages from the regression corpus

**Exit criteria:** success criteria 1 (HTML pages only), 5 and 6 met. This is the pilot milestone: a small group can start using the system on real pages.

### Phase 5: PDFs, real-time and hardening (6–8 weeks)

**Deliverables**

- PDF support: PDF.js viewer served from our origin, guest integration including pages not yet rendered, PDF fingerprinting as document identity
- Live updates in the sidebar from the SSE endpoint
- Multi-frame support: one sidebar serving several guests
- Accessibility pass on the sidebar and guest
- Security review of the full system against the threat model in the analysis note, with findings fixed
- Operational readiness: structured logging, metrics, health endpoints, backup and restore procedure for Postgres documented and tested
- User and operator documentation

**Exit criteria:** all success criteria met. Tag release 1.0.

### Phase 6: Management site (4–6 weeks, release 1.1)

**Deliverables**

- Nuxt application using `packages/api-client` only
- Users and groups administration, group membership, sharing overview, annotation browsing and search
- Any endpoint the site needs that does not yet exist is added to the OpenAPI document and server first, never to Nuxt server routes

**Exit criteria:** every operation the site performs is covered by the public API and contract tests.

## 6. Milestones

| Milestone | Marks | Phase |
|---|---|---|
| M0 Foundations | Repository, CI and local stack in place | 0 |
| M1 Specification 0.1 | Text model, fixtures, schema and OpenAPI document reviewed | 1 |
| M2 Guest decision | ADR accepted, regression corpus in CI | 2 |
| M3 Server on dev cluster | Contract tests green, ACL tests green, Helm deploy works | 3 |
| M4 Pilot | Bookmarklet, sidebar and server on real HTML pages | 4 |
| M5 Release 1.0 | PDFs, real-time, hardening complete | 5 |
| M6 Release 1.1 | Management site | 6 |

## 7. Requirements traceability

| Requirement (analysis note) | Where it is met | Verified by |
|---|---|---|
| 1. Arbitrary pages, changed pages, PDFs | Phases 2, 4, 5 | Anchoring regression corpus; PDF end-to-end tests |
| 2. W3C model and protocol, structured bodies | Phases 1, 3 | Contract tests; body profile tests |
| 3. Per-annotation ACL, enforced in search | Phases 1, 3 | Multi-principal ACL test suite |
| 4. Mainstream framework, stateless containers, few dependencies | Phases 0, 3 | Helm deployment with Postgres only |
| 5. Credentials and UI out of the page's reach | Phase 4 | Hostile-page test; frame-ancestors check |

## 8. Quality strategy

- **Contract tests** generated from the OpenAPI document run against the server with a real Postgres in CI. The spec cannot change without the tests changing.
- **Text-model fixture suite** runs against `packages/model` and against the guest in a real browser. It is published so third-party clients can run it.
- **Anchoring regression corpus** from Phase 2 runs on every guest change and reports anchored, orphaned and wrong-anchor counts; wrong anchors on "must not match" cases fail the build.
- **ACL tests** create several users and groups and assert what each can see through every read path, including search and SSE.
- **End-to-end tests** with Playwright through the bookmarklet.
- **Security tests**: a hostile host-page script that attempts to read tokens, annotation bodies and sidebar DOM; checks of CSP and frame-ancestors headers.
- **License checks** in CI on dependencies, plus a reviewed notice file for copied code.

## 9. Deployment and operations

- Images built in CI for each package that ships: API, sidebar static assets, PDF viewer, later the management site
- Configuration entirely through environment variables; no config files baked into images
- Helm chart from Phase 3 onward, exercised against a development cluster on every release
- Postgres provided by the cluster or a managed service; the chart does not run it
- SSE requires the ingress to allow long-lived connections; documented in the chart

## 10. Governance

- Architecture decisions recorded as ADRs; the open-decisions table in this plan is retired as each is written
- Contribution guidelines and a stated review turnaround from Phase 0, since contribution handling was part of why we are leaving Hypothesis
- The OpenAPI document and the text-model specification are versioned; breaking changes require a new major version of each
- Licensing conditions from the analysis note are tracked in a notice file and checked at each release

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Re-anchoring quality disappoints users | Pilot rejected | Regression corpus from Phase 2 as a gate; orphan handling and manual repair in the sidebar rather than guessing |
| Text model drift between guest, server and imports | Silent misplacement of annotations | One implementation in `packages/model`; published fixture suite for everyone else |
| Scope creep into PDFs, extension and real-time before the pilot | Pilot slips | PDFs and real-time are Phase 5; extension is deferred; pilot is HTML-only |
| Recogito single-maintainer dependency | Unfixed upstream bugs | Trial includes the Hypothesis-code alternative; pin versions; be prepared to vendor |
| Copied Hypothesis or Apache code becomes ours to maintain | Ongoing cost | Keep copied code in one package with a clear provenance file; restrict to anchoring, not UI |
| Spec-first slows early iteration | Phase 1 drags | Tag `spec-0.1` as "good enough to build"; allow minor-version changes through Phase 4 |
| ACL filtering in SQL becomes slow at scale | Search latency | Index design in Phase 1; load test in Phase 5 with representative volumes |
| OIDC provider differences | Login breaks on a new provider | Test against Keycloak locally and the production provider in Phase 3 |
| Team unfamiliarity with Fastify or Kysely | Early velocity | Phase 0 spike; both have small surfaces compared with full frameworks |

## 12. Immediate next steps

1. Review and agree this plan and the analysis note.
2. Create the repository and start Phase 0.
3. Assign Phase 1 (specification) and Phase 2 (guest trial) to run in parallel as soon as Phase 0's workspace exists.
