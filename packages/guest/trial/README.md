# Guest anchoring trial

Runs the guest's anchoring against the [regression corpus](../corpus/README.md) in headless Chromium and reports anchored, orphaned and wrong-anchor counts. Built in Phase 2 of the [project plan](../../../docs/web-annotation-plan.md) to choose the guest's base ([ADR 0017](../../../docs/adr/0017-guest-base-and-highlight-rendering.md)); since Phase 4 it is the guest's regression suite and gate (success criterion 5).

```bash
pnpm --filter @curanno/guest trial                 # all cases, the guest candidates
pnpm --filter @curanno/guest trial synth-hidden    # one case
pnpm --filter @curanno/guest trial --all           # include the Phase 2 candidates
pnpm --filter @curanno/guest trial --candidate hypothesis
```

Results land in [`results/results.json`](results/results.json) and [`results/summary.md`](results/summary.md). The run exits with status 1 when the `guest` candidate anchors any `mustNotMatch` annotation (a `guessed` verdict), or when an expectation cannot be located. The first run needs `pnpm --filter @curanno/guest exec playwright install chromium`.

## What runs

For every case, variant and candidate the harness opens the variant in a fresh page, injects `.build/__trial/runtime.js` (the candidates and helpers bundled by esbuild) and asks the candidate to anchor every annotation's stored selectors against the case's root. The returned DOM range is mapped to offsets in the root's `textContent` and compared with where the expectation locates the expected text:

| Verdict | Meaning |
| --- | --- |
| `anchored` | exactly the expected text |
| `approximate` | overlaps the expected text by at least half (intersection over union) |
| `missed` | nothing returned although the text exists |
| `orphaned` | nothing returned for a `mustNotMatch` annotation: the right answer |
| `wrong` | a range that is not the expected text |
| `guessed` | a range for a `mustNotMatch` annotation: the worst answer |
| `invalid` | the expectation could not be located in the variant: fix the corpus |

PDF cases are opened through `static/pdf-view.html`, which renders every page of the file as a PDF.js text layer (spans and `<br>`s, no canvas) inside `.page[data-page-number]` elements, the structure a PDF.js viewer has. The guest candidates anchor through the guest's own PDF integration (`src/integrations/pdf.ts`), which resolves each selector's page fragment to that page's text layer and looks on the other pages when the text is gone from its own; its handling of pages that are not rendered yet is covered by its unit tests, since this page renders everything. The legacy candidates receive the text selectors with the page fragment stripped.

## Candidates

Defined in `src/browser/candidates/`. Run by default:

- **guest**: `anchor()` from `packages/guest/src/anchoring`, on the project text model (ADR 0012, 0013): RangeSelector, then TextPosition, each checked against the quote, then quote matching with the minimum score and the quote-length floor from ADR 0017. The gate applies to this candidate.
- **guest-sweep**: the same code with both thresholds off, so the report's threshold sweep shows what every candidate match scored. Its `guessed` verdicts are expected and not gated.

Kept from Phase 2 and run only with `--all`. The corpus selectors now follow the project text model (code points of normalized text), which these libraries do not implement, so their numbers measure them on foreign selectors and are no longer comparable with the Phase 2 report, which is recorded in ADR 0017:

- **hypothesis**: `anchor()` from the vendored client code (`../vendor/hypothesis`). W3C `RangeSelector`s are converted to the client's XPath shape first.
- **recogito-default**: `createTextAnnotator` with the bundled `W3CTextFormat` adapter and no `selectorReviveFn`, so annotations are revived by `TextPositionSelector` offsets alone.
- **recogito-quote**: `createTextAnnotator` with our adapter (`src/browser/recogito-w3c-adapter.ts`, which keeps prefix and suffix) and a `selectorReviveFn` that accepts a position hit only when its text still equals the quote and otherwise runs `src/browser/match-quote.ts`, a fuzzy matcher over `approx-string-match` scored like the Hypothesis one, with no minimum score.
- **recogito-quote-strict**: the same with matches scoring below 0.8 rejected. The summary also contains a threshold sweep computed from `recogito-quote`'s recorded scores.

Both Recogito candidates go through the library's real loading path (adapter, revive, store) so the trial measures what the integration would do, not just the algorithm.

## Other commands

- `pnpm --filter @curanno/guest corpus:describe [--force] [case ...]` generates selectors from each annotation's `select` through the guest's `describe`, and checks that annotations marked `notAnnotatable` cannot be described.
- `pnpm --filter @curanno/guest corpus:pdf` renders `cases/*/src/*.html` to PDFs.
- `pnpm --filter @curanno/guest trial:highlights` compares highlight rendering techniques on the re-rendering and nested-scroll pages; see [highlight-rendering.md](highlight-rendering.md).
- `pnpm --filter @curanno/guest trial:a11y` runs the keyboard and accessibility-tree checks; see [keyboard-and-screen-reader.md](keyboard-and-screen-reader.md).

## Files

```
trial/
  src/run.ts                 the trial: build, serve, drive Chromium, classify, report
  src/describe.ts            selector authoring
  src/make-pdf.ts            PDF rendering for pdf cases
  src/highlights.ts          highlight rendering comparison
  src/a11y.ts                keyboard and accessibility-tree checks
  src/build.ts, server.ts    esbuild bundling and the static server (corpus + .build overlay)
  src/corpus.ts              case.json types and loader
  src/classify.ts            verdicts (unit tested)
  src/report.ts              results.json shape and summary.md
  src/browser/               code that runs in the page: candidates, measuring helpers, PDF view
  static/pdf-view.html
  results/                   committed output of the last full run
```
