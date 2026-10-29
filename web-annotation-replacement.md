# Options for a Web Annotation platform in 2026

This note looks at how to build an annotation system that can replace [Hypothesis](https://web.hypothes.is/) for our use. It draws on the source of:

- the [Hypothesis client](https://github.com/hypothesis/client), `main` at `a7b7400d0d70` (reviewed 2026-10-29)
- [Recogito Text Annotator](https://github.com/recogito/text-annotator-js), v4.3.7
- [Apache Annotator](https://github.com/apache/incubator-annotator), its final source before the project was retired in 2025
- Annotator itself (`openannotation/annotator`, 2.0.0-alpha)

## Why replace Hypothesis

Hypothesis is maintained, but changes we need, including small targeted pull requests, haven't been accepted because of their close focus on their
particular target markets. The technical concerns are:

- **Server framework.** The server (`h`) is built on Pyramid, a framework that our team isn't very familiar with. That makes it harder to fork, to work on and to find developers for.
- **Bifurcated language use.** THe Hypothes.is use of python on the backend and javascript on the frontend requires duplicate implementation of some
functionality, and the potential for some code drift.
- **Deployment.** The deployment process isn't well documented, and the Docker setup doesn't work well for production deployment, for example on Kubernetes. Elasticsearch is a required dependency, which adds to the operational load.
- **Structured annotation bodies.** Hypothesis doesn't support parts of the W3C Web Annotation model that we need, especially structured bodies such as `application/json` data.
- **Access control.** Hypothesis permissions are tied to groups. We want access control on individual annotations, and fine grained control of which individuals can read, write, and edit annotations.

Backwards compatibility with Hypothesis is not required, especially when we can adhere more closely to the W3C Web Annotation recommendations.

## Requirements

1. Annotate arbitrary web pages, including pages that change after they were annotated, and PDFs.
2. Use the [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) and [Protocol](https://www.w3.org/TR/annotation-protocol/), both W3C Recommendations since 2017, including bodies with structured data.
3. Per-annotation access control that is enforced in search results as well as on single annotations.
4. A server built on a mainstream framework, deployable as stateless containers with few stateful dependencies.
5. Keep login sessions, tokens and the annotation UI out of the reach of the annotated page's scripts.

## The architectural lesson from Hypothesis

Hypothesis splits its client into two parts:

- a small **guest** script injected into each frame of the page, which handles selection, anchoring and highlights
- a **sidebar** app in an iframe served from Hypothesis's own origin, which handles the UI, storage and login

The two parts talk over typed RPC on message channels. The client's [security overview](https://h.readthedocs.io/projects/client/en/latest/developers/security.html) treats the annotated page, and any script on it, as untrusted, and the split follows from that:

- **Credentials stay out of the page.** The login token lives in the sidebar origin's storage, and API calls are made from the sidebar.
- **Annotation content stays out of the page.** The guest gets only what it needs to draw highlights (selectors and IDs), not bodies, tags or authors. Selectors do include the quoted text, so the page can still see what was highlighted.
- **The UI is isolated.** Host-page CSS and scripts can't reach into the editor or viewer.
- **One sidebar can serve many frames,** such as iframes, PDF.js viewers or ebook readers.
- **The in-page footprint is small.** Only selection, anchoring and highlighting touch the page's DOM.

The limits matter as much as the benefits:

- The in-page guest is still exposed: the page can read or tamper with selection and highlights. The split limits what that code can reach, not the code itself.
- The protection only holds if the sidebar really is served from a different origin.
- The page can still remove, hide or cover the sidebar frame, so clickjacking defenses are needed. Shadow DOM, which Hypothesis uses for its injected controls, keeps out page CSS but is not a security boundary.
- Hypothesis also lets publishers pass a login grant token through page configuration. Any such shortcut makes the page part of the trust relationship again.

Because a replacement also annotates pages it doesn't control, it needs the same split. That's requirement 5, and it's also what makes multi-frame documents and PDFs workable. Neither Annotator nor Recogito has it: both keep annotation state and UI in the host page.

## Options

### Build on Annotator

Annotator's whole design is a single script inside the host page. Credentials sit in the page, and there's no multi-frame or PDF support. Its identity and authorization modules are client-side hooks, not a login system; the server must still authenticate and enforce access. Its data format (`quote` and `ranges`) predates the W3C model. Its anchoring (`xpath-range@0.0.5`, last released in 2014) stores XPath ranges with no fallback and no quote check, and its UI is jQuery-era widgets. Reaching the guest/sidebar split would mean replacing nearly all of it.

Worth keeping as ideas, not code:

- the module and hook model (`beforeAnnotationCreated` and similar)
- the per-action ACL model in `src/authz.js`, which is a reasonable starting point for per-annotation permissions

If existing Annotator data ever needs migrating, note that it stores one trimmed, combined quote across all ranges, with no prefix or suffix. It can't be turned into reliable W3C TextQuote selectors by renaming fields.

**Verdict:** not a suitable base.

### Fork the Hypothesis client

The Hypothesis client descends from early Annotator code but has diverged far from it. A fork gives a mature client immediately, including PDF support, multi-frame handling, replies and groups, maintained by a funded team. But the client is built around `h`'s API and data model throughout:

- a non-W3C annotation JSON shape
- group-based permissions
- `h`'s search parameters and WebSocket protocol

Structured bodies and per-annotation ACLs both need changes to the UI and the data model, which is exactly the part a fork shares with `h`. The fork would keep the technical debt we want to leave, and would need ongoing rebasing against a project that hasn't accepted our changes.

**Verdict:** not recommended as the long-term base. A compatibility layer for its API can still help early on (see below).

### A new project built from existing parts (recommended)

Build the server and sidebar new, and reuse existing code for the in-page guest, where years of fixes for edge cases are hard to reproduce.

## Recommended architecture

### Language and repository layout

TypeScript throughout, in one pnpm workspace:

| Package | Role |
|---|---|
| `packages/model` | Annotation types, JSON Schemas for body profiles, the text model (offset counting, whitespace and hidden-content rules), selector utilities, URL canonicalization, PDF fingerprinting, and the guest/sidebar RPC message types |
| `packages/api-client` | TypeScript client generated from the OpenAPI document |
| `packages/guest` | The in-page script (see below) |
| `apps/api` | The Fastify server |
| `apps/sidebar` | The sidebar app |
| `apps/web` | The management site, when needed |

The main reason for one language is the text model. If the guest, the server and any import tooling share one implementation of offset counting and selector handling, the drift risk listed under [Risks](#risks) becomes a matter of one package's tests rather than keeping two codebases in step. Python (Django or FastAPI) was considered and would be the right call if the maintainers were Python-first, but it would mean a second text-model implementation and more friction for `LISTEN/NOTIFY` and server-sent events.

### API-first development

The OpenAPI document is the contract between the server and every client, including our own:

- The spec is written by hand, not generated from code. The server binds its routes to the spec and validates against its schemas.
- Clients use a generated TypeScript client (`openapi-typescript` with `openapi-fetch`, or similar), never hand-written fetch calls.
- Contract tests run the server against the spec in CI, so neither side drifts from it unnoticed.
- The sidebar and the management site are ordinary API clients with no privileged path into the server.

### 1. Server

This is where most of our requirements are.

- **API:** the W3C Web Annotation Protocol, with JSON-LD annotations. The OpenAPI document is written by hand and is the contract (see [API-first development](#api-first-development)). The protocol already fixes most resource shapes; the spec work is the search endpoint, the ACL endpoints and the body profiles.
- **Framework:** Fastify, with routes bound to the OpenAPI document (for example through `fastify-openapi-glue`) so the spec's schemas become Fastify's request and response schemas. Fastify validates with Ajv, so request validation, body-profile validation and the spec share one JSON Schema toolchain.
- **Structured bodies:** the model already allows them, either as a body with `format: "application/json"` or as a typed JSON-LD node. Validate known body types with JSON Schema, keyed on the body's `purpose` or a profile, through the same Ajv instance.
- **Data access:** Kysely as a typed query builder over `pg`, with hand-written SQL where it matters: ACL filtering, full-text search and JSONB paths. An ORM gains little here because the hard queries are SQL anyway, and Prisma in particular fights `tsvector` and JSONB. Migrations as plain SQL files, run by Kysely's migrator or a standalone tool such as dbmate.
- **Storage and search:** Postgres as the only stateful dependency.
  - JSONB columns for bodies and targets
  - Postgres full-text search instead of Elasticsearch
  - `LISTEN/NOTIFY` fanned out over server-sent events for real-time updates. Node holds the long-lived connections this needs without extra infrastructure.
- **Login:** OpenID Connect against an external identity provider (Keycloak, Authentik, etc.) instead of a built-in account system, using `openid-client`.
- **Access control:** ACL rows in Postgres (annotation, principal, permission), enforced inside the SQL queries.
  - Search results must be filtered by permission, and doing that in SQL keeps search fast.
  - External relationship-based authorization services (OpenFGA, SpiceDB) make filtered listing harder. Consider one later if sharing rules grow complex.
- **Document identity:** decide what identifies an annotated resource (canonical URL, PDF fingerprint, ebook segment, version) and how annotations on equivalent URLs are found. This matters as much as selectors. Hypothesis's `html-metadata` and `pdf-metadata` integrations are a useful reference.
- **Deployment:** stateless containers configured through environment variables, with a Helm chart from early on.

### 2. Selectors and the text model

W3C-shaped JSON is not enough for annotations to anchor the same way in different clients. The spec defines TextQuote and TextPosition selectors over normalized text counted in Unicode code points, but implementations differ:

- **Offset units.** Hypothesis and Recogito count UTF-16 code units, not code points. In `A😀B`, `B` starts at offset 2 in code points and 3 in code units. Apache Annotator follows the spec.
- **Line breaks and hidden content.** Hypothesis treats `<br>` as a space when extracting quotes; Apache and Recogito read `foo<br>bar` as `foobar`. Recogito also skips content marked `not-annotatable` when counting offsets. None of them uses fully rendered text.
- **Scoped offsets.** Recogito can count offsets from a nearby element (`offsetReferenceSelector`), but its W3C adapter doesn't record which element, so those offsets aren't portable on their own.

So the data model needs a written text model: the offset unit, how whitespace, `<br>`, hidden and excluded content count, and how to scope offsets if we use that. The guest must follow it exactly.

The model also needs to represent anchoring failures: orphaned annotations, ambiguous matches and user repairs. Don't silently regenerate selectors against a changed page; that can lock in a wrong anchor. Keep the originally stored selectors.

None of the reviewed projects implements the W3C `FragmentSelector` with Media Fragments for audio or video (Hypothesis's `MediaTimeSelector` is a custom type for transcripts), so media annotation would be our own work if needed.

### 3. In-page guest

Whatever it is built from, the guest is framework-free TypeScript. It has to be small, must not fight the host page's scripts or CSS, and must not pull in Vue or any UI library.

There are two serious candidates and one source of building blocks:

- **The Hypothesis guest code.** It stores Range, TextPosition and TextQuote selectors, tries them in that order, and accepts a Range or TextPosition hit only if its text still equals the stored quote. Otherwise it falls back to fuzzy quote matching (`approx-string-match`) that scores candidates on the quote, a 32-character prefix and suffix, and closeness to the stored position. One quirk in the reviewed snapshot: the fast quote check uses `Range.toString()`, so a selection across a `<br>` falls through to fuzzy matching even on an unchanged page.
- **Recogito Text Annotator.** An in-page library for selection, anchoring, highlighting and annotation state that leaves the editor, storage and login to the host application. Its default format is internal (`{quote, start, end}`); an optional adapter converts to W3C TextQuote and TextPosition. It re-anchors by position alone.
- **Apache Annotator.** Selector libraries, not an annotation client: it describes a range as W3C selectors and matches them back, with a small highlighter. Proposed by Annotator and Hypothesis contributors as Annotator's successor, but written from scratch.

| | Hypothesis guest code (`src/annotator/`) | Recogito Text Annotator | Apache Annotator |
|---|---|---|---|
| **Re-anchoring after a page changes** | Strong: tries several selectors, then fuzzy quote matching, and checks position hits against the quote | Weak: character positions only, with no check that the text still matches | Medium: exact quote with prefix and suffix, so it survives edits elsewhere but not to the quote or its context. Returns all matches; the caller decides |
| **PDFs** | Yes, including pages that haven't been rendered yet | Yes, through its `pdf-annotator` package, using a PDF.js viewer it creates | No |
| **Multiple frames and the guest/sidebar split** | Built in | No; it's a single in-page library | No |
| **W3C model** | TextQuote and TextPosition (UTF-16 offsets); its RangeSelector is a custom shape | Optional adapter: TextQuote and TextPosition (UTF-16 offsets), accepts only a subset of W3C targets, drops prefix and suffix when parsing | Closest: code-point offsets, W3C RangeSelector, CssSelector and `refinedBy`. No XPathSelector |
| **Highlight rendering** | Wraps text in elements | Positioned spans in an overlay layer, or the CSS Custom Highlight API, so annotated text isn't wrapped | Wraps text in elements |
| **Packaging and maintenance** | Internal TypeScript modules; the npm package ships only built bundles. We'd copy it in and maintain our copy | Maintained npm package with frequent releases, but largely one author's work | Retired and archived in 2025. Last npm release 0.2.0 (2021); the newer source was never released |
| **License** | BSD-2-Clause | BSD-3-Clause | Apache-2.0 |

Wrapping highlights can interfere with pages that re-render their DOM (React and similar). Overlay highlights avoid that but have to track layout changes. Neither keeps anchors valid across re-renders or virtualized content by itself.

The candidates can be combined. Recogito's `selectorReviveFn` option lets the host supply its own re-anchoring, so Hypothesis-style quote matching could be used as a fallback whenever a stored position no longer matches its quote. That needs our own W3C adapter too, since Recogito's discards the prefix and suffix that quote matching relies on. Apache Annotator's matchers are another option for exact matching, but adopting archived code means maintaining it ourselves.

**Suggested approach:** decide with a short trial. Annotate a set of real, frequently edited pages and some PDFs, change the pages, and see how each approach re-anchors. Include overlapping and discontiguous selections, DOM rewrites, hidden and excluded text, non-Latin text and emoji, long documents and nested scrolling, and check keyboard and screen-reader use.

- If Recogito plus a quote-matching fallback holds up, it's the lower-maintenance option, with the single-maintainer risk noted below.
- Otherwise, copy in the Hypothesis guest code.

Either way, the guest/sidebar messaging layer has to be ours.

### 4. Sidebar

- Build it new, in an iframe served from the server's own origin, talking to the guest over a small postMessage RPC protocol. Hypothesis's `frame-sync` and `shared/messaging` are a useful reference.
- Vue 3 with Vite, as a plain single-page app. It runs in an iframe with no SEO or first-paint concerns, so Nuxt's server rendering adds nothing here.
- Send the guest only selectors and IDs, as Hypothesis does.
- This is where the editors for structured bodies and the ACL-sharing interface go, which Hypothesis would have to retrofit.

### 5. Management site

Users, groups, sharing and administration will eventually need a site of their own. Build it in Nuxt, since the team knows Vue, as a client of the same API through the generated client:

- No business logic in Nuxt server routes. Nitro's `server/api` directory makes it easy to grow a second backend by accident. Proxying or session handling are the only acceptable uses, and even those should be questioned.
- Everything the site does must be possible through the public API. That keeps the API complete and the frontend/backend split enforceable.

It is not needed for a first release; the sidebar and a bookmarklet are enough to test the system end to end.

### Optional: a Hypothesis-compatible API layer

A thin layer that speaks `h`'s API would let the unmodified Hypothesis client run against the new server early on. That gives a working end-to-end system while the sidebar is being built. Keep it separate from the core data model so it doesn't constrain it, and drop it once our own client is ready.

## Licensing

All the candidates allow reuse, with conditions to keep:

- **Hypothesis client:** BSD-2-Clause; its Annotator-derived parts are MIT. Keep both notices in copied code.
- **Recogito:** BSD-3-Clause, which also bars using contributor names for endorsement.
- **Apache Annotator:** Apache-2.0, which adds patent terms, NOTICE preservation and marking changed files.
- **Annotator:** MIT or GPL-3.0-or-later.

Check dependency licenses as well as the top-level ones.

## Risks

- **Scope.** PDF support, a browser extension and real-time sync each take substantial work. Decide which ones are needed for a first release.
- **Re-anchoring quality.** This is the part users notice most when it fails, and it's the main thing the guest-code trial must check. No strategy both recovers from every edit and avoids every wrong match.
- **Text model drift.** If the guest, server and any imported data disagree on how text is counted, annotations shift or fail to anchor without obvious errors. The shared model package removes most of this within our own code. Imported data and third-party clients still need a published fixture suite of text-model test vectors that any implementation can run.
- **Dependency health.** Recogito depends heavily on one maintainer. Copied Hypothesis code and Apache Annotator code become ours to maintain.
- **Community.** Part of the problem with Hypothesis is how contributions are handled, not the code. A new project needs contribution guidelines and timely review from the start.

## Suggested first steps

1. Set up the pnpm workspace and write the OpenAPI document and the model package: W3C annotations, body validation, the ACL model, document identity and the text model, with the text-model fixture suite.
2. Run the guest-code trial described above.
3. Build a minimal Fastify server and Vue sidebar from the spec, with a browser bookmarklet to inject the guest, and try them end to end on real pages.
