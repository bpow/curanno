# Hypothesis client anchoring code

Copied from <https://github.com/hypothesis/client> at commit
`a7b7400d0d706d4357ec37c2a3610b25dcca89d5` (2026-10-15) on 2026-10-29.

License: BSD-2-Clause, with Annotator-derived parts under MIT. The full
notice is in [LICENSE](LICENSE) and both parts of it apply to this directory.

## Files

| Here                        | Upstream                                  | Changes                                                              |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `anchoring/html.ts`         | `src/annotator/anchoring/html.ts`         | Import path for selector types                                       |
| `anchoring/types.ts`        | `src/annotator/anchoring/types.ts`        | Import path for selector types                                       |
| `anchoring/match-quote.ts`  | `src/annotator/anchoring/match-quote.ts`  | None                                                                 |
| `anchoring/rendered-text.ts`| `src/annotator/anchoring/rendered-text.ts`| None                                                                 |
| `anchoring/text-range.ts`   | `src/annotator/anchoring/text-range.ts`   | None                                                                 |
| `anchoring/trim-range.ts`   | `src/annotator/anchoring/trim-range.ts`   | None                                                                 |
| `anchoring/xpath.ts`        | `src/annotator/anchoring/xpath.ts`        | None                                                                 |
| `types/api.ts`              | `src/types/api.ts`                        | Excerpt: only the four selector types the anchoring modules use      |

## Ported

Phase 4 ported the parts the guest needs onto the text model in
`packages/guest/src/anchoring/` (ADR 0017): `xpath.ts` (simple XPath
generation and evaluation) and the scoring of `match-quote.ts` are derived
from the files here and say so in their headers; the selector order and
quote check of `html.ts` are reimplemented over `packages/model`. The copies
in this directory stay verbatim as the reference and as the trial's
`hypothesis` candidate.

## Left out

- `src/annotator/anchoring/pdf.ts`, `placeholder.ts`, `text-in-rect.ts`:
  anchor inside a running PDF.js viewer (`PDFViewerApplication`) and handle
  pages that are not yet rendered. The Phase 2 trial anchors against a fully
  rendered PDF.js text layer, so these are not exercised. Copy them in Phase 5
  if this code base is chosen.
- `src/annotator/anchoring/test/`: upstream tests use Mocha and Chai and the
  client's own test bootstrap. The anchoring regression corpus in
  `packages/guest/corpus/` covers the same ground for our purposes.

## Dependencies

`match-quote.ts` imports `approx-string-match` (MIT), which is a
devDependency of `@scale/guest`.

## Updating

Fetch the commit you want, copy the files listed above over these, re-apply
the import path change, and record the new commit here and in
`docs/third-party-notices.md`.
