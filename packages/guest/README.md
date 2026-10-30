# Guest

The script the bookmarklet injects into an annotated page (ADR 0007, 0008). It handles selection, anchoring and highlights, and talks to the sidebar iframe over the [guest/sidebar RPC protocol](../../docs/guest-sidebar-rpc.md). It never sees annotation bodies, tags, authors or tokens.

## Layout

| Path                 | Role                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/anchoring/`     | Selectors to ranges and back, on the text model from `@curanno/model` (ADR 0012, 0013, 0017)             |
| `src/highlights/`    | CSS Custom Highlight API renderer, overlay fallback, hit testing                                       |
| `src/observers/`     | Mutation and selection observers                                                                      |
| `src/integrations/`  | Where the text is and when it changed: an HTML page, or a PDF.js viewer with pages that come and go  |
| `src/rpc/`           | The guest's end of the protocol (host and sub-frame connections, the host's port provider), the in-memory fake sidebar and its page |
| `src/frames.ts`      | Injects the bundle into the page's same-origin frames                                                 |
| `src/guest.ts`       | Wires it together for one frame; `src/bundle.ts` is the IIFE entry the bookmarklet loads             |
| `scripts/`           | `bundle` (esbuild), `bookmarklet`, `dev` (two-origin development server), `serve-corpus`, `serve`    |
| `dev/`               | Sample host page and the fake sidebar page                                                            |
| `test/browser/`      | Playwright tests: text-model fixtures in Chromium, RPC against the fake sidebar, hostile host page    |
| `trial/`, `corpus/`  | The [anchoring regression suite](trial/README.md); `pnpm --filter @curanno/guest trial` is the gate     |
| `vendor/hypothesis/` | The Hypothesis anchoring modules the port derives from, kept verbatim with their notice               |

## Frames and PDFs

The bundle runs one guest per frame. In the top frame the guest is the **host**: it holds the sidebar iframe, injects the bundle into same-origin frames (now and as they appear or navigate) and gives the guests of all other frames their ports to the sidebar without reading their traffic. In any other frame the guest connects through the host ([protocol, section 3](../../docs/guest-sidebar-rpc.md)); a cross-origin frame's page has to load the bundle itself. Our PDF viewer (`apps/pdf-viewer`) builds the guest in with the PDF integration, which anchors each page's text layer as PDF.js renders it and the text content of pages not yet rendered.

## Anchoring

`createScope(root)` extracts the root's text and map once; `describe(scope, domRange)` returns `[TextQuoteSelector, TextPositionSelector, RangeSelector]`; `anchor(scope, selectors)` tries the range, then the position, each accepted only when its text equals the stored quote, then quote matching, and returns `anchored`, `ambiguous` (several equally good candidates) or `orphaned` (ADR 0010). Quote matches below `MIN_QUOTE_SCORE` (0.75) are orphans, and quotes shorter than `MIN_FUZZY_QUOTE_LENGTH` (8 code points) are matched exactly only. The RangeSelector's XPaths are relative to the scope root and its refining offsets count code points of the named element's own text (text model, section 4).

## Trying it

```bash
pnpm --filter @curanno/guest dev
```

serves a sample page on `127.0.0.1:5180` and the fake sidebar plus the bundle on `localhost:5181`, rebuilds on change, and prints a bookmarklet that works on any http page (an https page blocks the http bundle as mixed content). Corpus pages are at `/cases/<case>/<file>.html` on the first origin. In the fake sidebar, select text in the page and press "Annotate selection".

With `-- --sidebar-origin http://localhost:5173` the guest opens the real sidebar from `pnpm --filter @curanno/sidebar dev` instead (`--sidebar-path` defaults to `/sidebar/`, where the sidebar app lives), so the whole client runs against the API and Keycloak; the repository README has the full recipe. `pnpm --filter @curanno/guest serve:corpus -- --host 127.0.0.1 --port 4180` serves the corpus and the built bundle alone, for the sidebar's bookmarklet suite.

For a deployment, build the bundle and generate the bookmarklet for where it and the sidebar are served:

```bash
pnpm --filter @curanno/guest bundle
pnpm --filter @curanno/guest bookmarklet -- --bundle-url https://annotations.example/guest.js --sidebar-origin https://annotations.example --sidebar-path /sidebar/
```

## Tests

`pnpm test` runs the unit tests (anchoring over happy-dom, the RPC over Node's `MessageChannel`, configuration, document metadata). `pnpm --filter @curanno/guest test:browser` runs the Playwright suite and `pnpm --filter @curanno/guest trial` the corpus; both need `pnpm --filter @curanno/guest exec playwright install chromium` once and run in CI's `guest-trial` job.
