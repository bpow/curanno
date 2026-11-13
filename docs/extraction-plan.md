# Suggested annotations: extraction plan

**Status:** Draft, 2026-11-13.

How the sidebar asks a language model for annotation suggestions on the open document. Each suggestion is a quote plus a structured body for a registered profile. The model runs behind a configured endpoint, which can be a local Ollama, so a deployment can keep document text on the user's machine. This plan covers what to build, in what order, and how we know each step works. The decisions it makes get ADRs before code (step 0).

## 1. Goals

- A curator picks a profile and asks for suggestions on the open page or PDF. The sidebar shows candidate annotations, each anchored in the page and holding a body that already validates against the profile. The curator accepts, edits or discards each one.
- Nothing is saved until the curator accepts it. An accepted suggestion becomes an ordinary annotation made by the curator, with provenance that records the model.
- The endpoint is configuration. The first target is an OpenAI-compatible chat completions API. Ollama, llama.cpp's server, vLLM and LM Studio all serve one, and most hosted providers do too.
- A deployment can require that document text never leaves the machine by allowing only loopback endpoints.

### Not in this plan

- Batch extraction over many documents, or extraction without a person reviewing the results.
- A hosted endpoint that we run. Section 7 records what it would need.
- Credentials for third-party endpoints (section 7).
- Tool use or agent loops. One request per chunk returns JSON, and nothing else.

## 2. Data flow

```
 Guest (page)                 Sidebar                         Endpoint (e.g. localhost:11434)
 ────────────                 ───────                         ──────────────────────────────
                    ◄──────── text.request
 extractText per scope
 text.report {scopes} ──────►  @curanno/extract:
                                 chunk text
                                 build prompt + output schema
                                 POST /v1/chat/completions ────►
                                                       ◄──────  JSON {suggestions: [...]}
                                 anchor quotes in scope text
                                 validate values (ProfileRegistry)
                                 resolve ontology labels (/x/ontologies)
                    ◄──────── annotations.anchor (suggestion ids)
 draw "suggested" highlights
                               curator accepts → POST /annotations (ordinary create)
```

The guest/sidebar principles still hold ([RPC §1](guest-sidebar-rpc.md)). The new messages carry page text from the guest to the sidebar, which the page already has, and nothing from the sidebar to the page except selectors and suggestion ids. The page never sees bodies, model output or the endpoint.

## 3. `packages/extract`

This is a new package that depends only on `@curanno/model`. It has no DOM, no Vue and no API client, so the sidebar, a Node evaluation CLI and any later host can use it as is.

### 3.1 Interface

```ts
interface ExtractionInput {
  scopes: ScopeText[];               // one per text-model scope: body, or one PDF page
  profile: BodyProfile;
  instructions?: string;             // curator's optional guidance, appended to the prompt
}

interface ScopeText {
  key: string;                       // opaque to extract; the sidebar maps it back to a target
  text: string;                      // normalized text (text model §4–7)
}

interface Endpoint {
  url: string;                       // base URL; extract appends /v1/chat/completions
  model: string;
}

interface Suggestion {
  id: string;                        // urn:uuid, used for highlights before saving
  scope: string;                     // ScopeText.key
  selectors: { quote: TextQuoteSelector; position: TextPositionSelector };
  value: unknown;                    // validated against the profile
  unresolvedTerms: string[];         // labels the ontology lookup did not match
}

function extract(input, endpoint, options: {
  signal?: AbortSignal;
  resolveTerms?: (ontology: OntologyRef, labels: string[]) => Promise<Map<string, Term>>;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ suggestions: Suggestion[]; rejected: Rejection[] }>;
```

`rejected` lists each output that was dropped and why (quote not found, ambiguous, invalid value), for the evaluation CLI and a "details" view. The sidebar does not show it to the curator by default.

### 3.2 Steps

1. **Output schema.** Derive the schema the model must produce from the profile's schema: `{suggestions: [{quote: string, value: <profile value schema>}]}`. Then project it to the subset that constrained decoders accept:
   - Remove the `ontology` keyword and other annotation keywords.
   - Turn each ontology `{id?, label}` array into an array of label strings, because the model never supplies IDs (ADR 0031).
   - Drop `$id`, `format`, and any `pattern` the target cannot handle.

   The projection is a pure function with unit tests over every built-in profile.
2. **Prompt.** Send a system message built from the profile's `title`, its `description` and each field's `title` and `description`. Tell the model to quote verbatim, not to paraphrase, and to treat the document as data, not instructions. The document goes in a delimited user message. Prompts are versioned constants (`PROMPT_VERSION`), recorded in provenance.
3. **Chunking.** Split each scope's text on paragraph boundaries (`\n\n` in the normalized text) into chunks under a configured character budget, with overlap. A PDF page is a scope and is never joined with the next page, because a target cannot span pages (text model §11). Suggestions from the overlap are deduplicated by anchored range and equal value.
4. **Request.** Send `POST {url}/v1/chat/completions` with `response_format: {type: "json_schema", json_schema: {strict: true, schema}}`, `temperature: 0`, using `fetch` with no SDK. Chunks run with a small concurrency limit (default 2, since a local GPU serializes requests anyway). An unparseable response is retried once, then rejected.
5. **Anchoring.** Look for each quote with the text model's `findQuote` in its own chunk first, then in the whole scope text:
   - Exactly one occurrence: keep it.
   - Several occurrences: keep the one inside the chunk the suggestion came from. If that is still ambiguous, drop it as ambiguous.
   - None: retry with whitespace collapsed and typographic quotes and dashes folded. If that still finds nothing, drop it.

   Do no fuzzy matching. A quote the model altered is a quote we cannot vouch for. Then build the TextQuote and TextPosition selectors with `DEFAULT_CONTEXT_LENGTH`, so they look exactly like ones the guest describes.
6. **Ontology resolution.** Pass each label array to `resolveTerms`. In the sidebar that is a search of `/x/ontologies/{name}/terms`. An exact label or synonym match (case-insensitive) stores `{id, label}`. Anything else stores `{label}` and is listed in `unresolvedTerms`, so the editor can point to it.
7. **Validation.** Validate the resolved value with `ProfileRegistry.validate`, through the same Ajv setup the sidebar already uses. An invalid value is dropped.

### 3.3 Evaluation CLI

`pnpm --filter @curanno/extract eval -- --endpoint URL --model NAME --corpus DIR` runs the pipeline over a corpus. Each case is an HTML or PDF-text fixture with the expected annotations. For each profile it reports how many expected quotes were found (recall), how many suggestions were correct (precision) and how many fields matched. It also reports rejections by reason and the time per chunk. HTML fixtures go through the text model with a DOM library adapter, as the fixture tests already do.

The corpus starts with a handful of open-access case reports annotated by hand with the case-individual profile. The CLI is not part of CI because it needs a model. CI runs the pipeline against a fake endpoint (3.4).

### 3.4 Tests

- Unit tests cover schema projection, chunking (boundaries, overlap, dedupe, the PDF page limit), response parsing, each anchoring outcome, ontology resolution with a stub, and validation.
- A fake OpenAI-compatible endpoint, an in-process handler that returns scripted responses, drives the whole `extract` call. That includes malformed JSON, a hallucinated quote, an ambiguous quote, an invalid value and an aborted request.

## 4. Guest and RPC

- **Capability.** `guest.hello` gains `capabilities.text: true`. The sidebar offers suggestions only when the guest says it can supply text. This is an additive optional field, so the protocol version stays 2 (RPC §1). Older guests, including extension builds already installed, simply don't get the feature.
- **Messages.** The sidebar sends `text.request` with a request id. The guest answers with `text.report {requestId, scopes: [{scope, text}]}`. For HTML the scope is the body. For the PDF viewer there is one scope per page, from `pdf-text.ts`, which already builds page text without rendering the page. `scope` is a descriptor the sidebar can turn into a target: none for the body, `{page: N}` for PDF pages.
- **Rules.** A guest reports only its own frame's text. The sidebar asks only the guest whose document the curator chose. A late or duplicate `text.report` replaces the earlier one, which keeps with the "events, not requests" principle.
- **Highlights.** Suggestions are anchored with the existing `annotations.anchor` under their `urn:uuid` ids. The guest needs no new message, but it needs a highlight style for suggestions. This plan proposes an optional `style: "suggested"` field on `AnchorRequest`, which is additive. Withdrawing a suggestion uses `annotations.unanchor`.
- **Spec and tests.** Update `docs/guest-sidebar-rpc.md`, the guards in `packages/model/src/rpc/` and their tests, the fake sidebar, and the guest's `connection.test.ts`. Add browser tests that check `text.report` against the text-model fixtures for HTML and against a PDF from the corpus.

Page text is untrusted input to the model, so prompt injection is expected. What limits the damage: the model has no tools; its output must anchor as verbatim quotes and validate against the profile; nothing is saved without a person accepting it; and the result is only ever shown to the person who asked. The security review gets an entry that says so.

## 5. Configuration and serving

- **API environment.** `EXTRACT_ENDPOINTS` is a JSON list of `{label, url, models?, local?}`, empty by default, which leaves the feature off. `EXTRACT_LOCAL_ONLY=true` refuses any entry whose host is not loopback (`localhost`, `127.0.0.1`, `[::1]`). This is how a deployment makes "text stays on this machine" a property of its configuration rather than of user discipline.
- **Sidebar `config.json`.** The API passes the endpoint list through. The curator picks an endpoint and a model in the sidebar. The last choice is stored in `localStorage`, which is not a credential and is per-browser convenience only.
- **CSP.** The sidebar's `connect-src` (`apps/api/src/static.ts`) adds each configured endpoint origin. An endpoint that is not configured cannot be reached from the sidebar. That is the enforcement point, and `static.test.ts` checks it.
- **Ollama.** Users run it with `OLLAMA_ORIGINS` set to the sidebar's origin. The operator and user guides give the command. The dev setup (`just dev`) documents `http://localhost:11434` as the default dev endpoint, and compose can optionally run an `ollama` service.
- **Browser limits to verify early.** These decide how well the local path works on a deployed https sidebar:
  - An https page fetching `http://localhost` is treated as a trustworthy origin in Chromium and Firefox, but Safari's behaviour needs checking.
  - Chromium's Local Network Access shows a permission prompt when a public origin fetches loopback, and we need to see how that looks in the sidebar iframe.

  Section 8 tracks both.

## 6. Sidebar

- **Entry point.** A "Suggest annotations" action on the document panel, shown when there are endpoints, the guest has `capabilities.text`, and the curator can create annotations. A dialog asks for the profile (from `/x/profiles`), the endpoint and model, and optional instructions. It shows which host the text will go to ("Document text will be sent to localhost:11434"), and it has a cancel button wired to `AbortSignal`.
- **Store.** A suggestions store per document, kept in memory and discarded on reload or navigation. Progress shows chunks done out of total.
- **List.** Suggestions appear in their own section above the annotations, as cards in the suggested style. Each card shows the quote, a `StructuredBodyView` of the value, and its unresolved terms. Hovering or activating a card works as it does for annotations.
- **Accept.** This opens `AnnotationComposer` with the target and the value filled in, and the profile's `defaultPurpose`. Saving is an ordinary create, with the ACL defaults the composer already applies. The suggestion is then withdrawn. "Accept all" is not provided in the first version.
- **Discard.** Discarding withdraws the suggestion from the store and from the guest.
- **Provenance.** This uses the W3C model's own terms, with no extension:
  - **Annotation `creator`** is the curator, which the server already assigns from the token.
  - **Body `creator`** records the model that suggested the body, for example `{"type": "Software", "name": "curanno-extract", "nickname": "<model> / prompt <PROMPT_VERSION>"}`. The W3C model allows a creator on each body, and more than one when agents worked together. If the curator edits the value before saving, they are added as a second `Person` creator. Body `created` is the time of the suggestion.
  - **A hand-written body** beside it has only the curator as creator.
  - **`generator` is not used for the model.** The W3C model defines it as the agent that generated the annotation's serialization, which is the curanno client.

  Body `creator` is the client's claim, stored as sent, while the annotation's creator is the server's. If more detail is needed later (prompt version, run, whether the value was edited), PROV-O terms such as `prov:wasGeneratedBy` can go in the extension context alongside body `creator`, without replacing it.
- **Tests.** Component tests for the dialog, the cards and the accept flow. A Playwright test (`e2e:guest`) runs against a stubbed endpoint on a corpus page, from request to saved annotation.

## 7. Later: a hosted endpoint

A hosted endpoint would be a small service we run in front of a model. The plan leaves it out but keeps the way open:

- The extract pipeline is unchanged, because the endpoint is just another URL in `EXTRACT_ENDPOINTS`.
- Authentication is the one open problem. The sidebar must not hold third-party API keys. It should also not send the user's access token to a service the token was not issued for. A hosted endpoint we run would accept tokens issued for its own audience, for example through token exchange, or sit behind the API under `/x/extract` as a proxy that forwards to a model with a server-side key. The proxy is simpler, and it would mean document text passes through the deployment, which `EXTRACT_LOCAL_ONLY` deployments forbid.
- Batch extraction (a folder of PDFs, or a corpus) could reuse `packages/extract` from a CLI or from a desktop shell. That is where the Tauri idea comes back.

## 8. Steps

| Step | Delivers | Done when |
| ---- | -------- | --------- |
| 0. Decisions | ADRs: suggestions from an OpenAI-compatible endpoint configured per deployment, with a loopback-only mode; the text RPC messages; provenance of accepted suggestions | ADRs accepted |
| 1. Spike | Checks a deployed-origin https sidebar fetching local Ollama in Chromium, Firefox and Safari (mixed content, Local Network Access prompt inside the iframe) and structured output with two candidate local models on one case report | Findings written into the ADR. If Safari or Chromium blocks the local path, revisit before step 3 |
| 2. `packages/extract` | Section 3: pipeline, fake endpoint, unit tests, evaluation CLI, a first corpus of 5–10 annotated case reports | `pnpm check` green, and the eval CLI reports baseline numbers for one local model |
| 3. Guest and RPC | Section 4: capability, `text.request` and `text.report`, suggested highlight style, spec update | Guest browser tests and RPC guard tests green, and the HTML and PDF text matches the text-model fixtures |
| 4. Configuration | Section 5: `EXTRACT_ENDPOINTS`, `EXTRACT_LOCAL_ONLY`, `config.json`, CSP | `static.test.ts` covers CSP for configured and rejected endpoints |
| 5. Sidebar | Section 6 | Component tests and the stubbed-endpoint Playwright test green, axe checks pass |
| 6. Documentation | User guide (using suggestions, running Ollama), operator guide (endpoints, local-only mode), security review entry (prompt injection, where text goes) | Reviewed |

Steps 2 and 3 can run in parallel once step 0 is done.

## 9. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Browsers block an https sidebar from reaching `localhost` | Spike first (step 1). Fallback is the extension, whose service worker can fetch loopback for the sidebar through the existing bridge (ADR 0029) |
| Local models produce poor structured output for clinical text | Evaluation CLI with a real corpus before building UI. The output schema and prompt are versioned so results can be compared |
| Long documents exceed context windows, or are slow on local hardware | Chunking with a budget, progress and cancel in the UI, concurrency limit. Restricting a run to the selected text is an easy follow-up |
| Profile schemas use features constrained decoders reject | Projection is tested over every built-in profile. Registered profiles that fail projection are shown as unavailable for suggestions, with the reason |
| Prompt injection from page text | Section 4: no tools, verbatim anchoring, schema validation, a person reviews every suggestion |
| Curators accept suggestions uncritically | No "accept all", provenance on every accepted body, and suggestions look different from saved annotations |
