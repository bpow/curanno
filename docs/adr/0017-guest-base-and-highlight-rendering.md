# 0017. Build the guest's anchoring on the Hypothesis client's code and render highlights with the CSS Custom Highlight API

**Status:** Accepted

**Date:** 2026-10-29

## Context

ADR 0008 left two choices to the Phase 2 trial: which existing code the guest's anchoring is built from, and how highlights are drawn. The candidates were Recogito Text Annotator (`@recogito/text-annotator` 4.3.7) with its default position-based re-anchoring, Recogito with a Hypothesis-style quote-matching fallback supplied through `selectorReviveFn` and our own W3C adapter, and the Hypothesis client's anchoring modules (`src/annotator/anchoring/`, BSD-2-Clause) copied into the repository. Apache Annotator was not wired in: it is archived, its last release predates its selector work, and the trial's quote matching covers what its exact matchers do.

The trial ran each candidate against the anchoring regression corpus in `packages/guest/corpus/`: 14 cases, 31 case-variant pairs, 227 annotation-variant pairs, of which 127 are on edited variants and 20 are marked `mustNotMatch`. The corpus has real pages with real edit histories (three Wikipedia revisions in English, Japanese and Arabic, an MDN page, a Project Gutenberg novel), real and generated PDFs anchored through a PDF.js text layer, React and Vue pages with edited and remounted data, and synthetic pages for overlapping and discontiguous selections, hidden and excluded text, emoji and combining marks, nested scrolling, and deleted text with near-duplicates. The harness, its verdicts and the full report are in `packages/guest/trial/`.

### Re-anchoring results (edited variants only; `trial/results/summary.md`)

| Candidate | Recall | Must-not-match held | Missed | Wrong | Guessed |
| --- | ---: | ---: | ---: | ---: | ---: |
| recogito-default | 31% | 11% | 5 | 70 | 17 |
| recogito-quote (no score threshold, the Hypothesis policy) | 99% | 47% | 1 | 0 | 10 |
| recogito-quote-strict (minimum score 0.8) | 91% | 100% | 10 | 0 | 0 |
| hypothesis | 100% | 47% | 0 | 0 | 10 |

Recall is anchored plus approximate over annotations whose text exists in the variant; "held" is the share of `mustNotMatch` annotations correctly reported as orphans. On the unedited originals every candidate anchored everything except `recogito-default` on the page with a `.not-annotatable` element, where its offsets, which skip such elements, disagree with the corpus's by a constant and every anchor lands wrong.

What the numbers say:

- Position-only revival (`recogito-default`) is not usable on pages that change: 70 wrong anchors out of 127, because it returns whatever text now sits at the stored offsets and never checks it against the quote.
- Once a quote-matching fallback is in place, the Hypothesis code and the Recogito integration behave the same. The ten guesses they share are the same annotations: short quotes ("4.2", "Perusall", "1.0 ml"), a heading deleted while similar headings remain, a sentence rewritten in Thai. They come from the matcher's policy of accepting up to half the quote's length in edits, not from the base.
- The policy is tunable. Re-reading `recogito-quote`'s recorded scores at different minimum scores gives: 0.65 → 99% recall, 74% held; 0.70 → 98%, 89%; 0.75 → 98%, 100%; 0.80 → 91%, 100%. A threshold of 0.75 removes every false anchor in the corpus at the cost of one re-anchor (the Wikipedia sentence whose Annotea clause was added later, an approximate match scoring 0.68). The margin is thin: the guesses scored between 0.35 and 0.74, and the two highest were a rewritten Thai sentence and a short Arabic phrase, so a floor on quote length is needed alongside the score.
- Anchoring time is small for both: under 20 ms for every variant, including the 735,000-character novel, where the quote fallback searched the whole text.
- The corpus's offsets are UTF-16 `textContent` offsets. ADR 0012 and ADR 0013 (Phase 1) define a different text model: code points of NFC text with whitespace collapsing and excluded content. Whichever base is chosen must describe and anchor through `packages/model`'s text model, so its own offset counting is replaced either way; what carries over is the selector-chaining logic, the quote matcher and the handling of ranges, XPaths and `<br>`.

### Highlight rendering (`trial/highlight-rendering.md`)

Wrapped elements, Recogito's overlay spans and the CSS Custom Highlight API were drawn on the React and Vue pages and then subjected to an in-place data patch, a remount and a redraw, and on the nested-scroll page to scrolling and resizing. No technique keeps highlights across a re-render; all three come back after re-anchoring and redrawing. Wrapping left both frameworks' pages with a paragraph containing text from a different item after the patch, silently. Recogito's overlay drifted 179 to 2102 px from its text once a nested container was scrolled or the window resized, and never drew an annotation outside the panel's initial view. CSS highlights have no DOM footprint, track scrolling and reflow natively, and are missing only in Firefox before version 140 and older Safari. In forced-colors mode only wrapped `<mark>` elements stayed visible.

### Keyboard and screen reader (`trial/keyboard-and-screen-reader.md`)

Recogito creates an annotation from a keyboard selection only when Shift is released over it; selections placed without key events are ignored. The Hypothesis selection observer reacts to `selectionchange` and needs no key release. Neither puts anything focusable in the page. Overlay and CSS highlights leave the accessibility tree unchanged; wrapping inserts `mark` nodes.

### Weighing the two viable bases

The two viable options re-anchor equally well with a tuned matcher. The choice is therefore about what else each brings and what we must write around it.

Recogito gives us a maintained selection handler, a store with a spatial index, two renderers and hover and selection state, for the price of a dependency on one maintainer, an adapter we must write to keep prefix and suffix, a revive function we must write, and three things we would have to replace or patch: its offset counting (to follow ADR 0012 and 0013), its selection handler (to accept assistive-technology selections) and its overlay's scroll tracking. Its store and state are also designed for an in-page application, while ADR 0007 keeps state in the sidebar and gives the guest only selectors and identifiers; much of what the library carries would go unused.

The Hypothesis modules give us the selector chaining, quote matcher and range utilities as about 1,200 lines of TypeScript we already understand, with no runtime dependency beyond `approx-string-match`, and nothing that assumes in-page state. Around them we write selection handling, highlight drawing and layout tracking, which we would have to write or patch in the Recogito case too. The code becomes ours to maintain, which is the risk the plan names; the trial shows how little of it there is.

## Decision

- The guest's anchoring is built on the Hypothesis client's anchoring modules, kept under `packages/guest/vendor/hypothesis/` with their license and provenance. Phase 4 ports them onto `packages/model`'s text model (`extractText`, `describeRange`, `findQuote`) so that selectors are produced and consumed exactly as ADR 0012 and 0013 specify; the quote matcher and the selector order (range, then position, then quote, each checked against the stored quote) are kept.
- Fuzzy quote matching accepts a match only above a minimum score, initially 0.75, and never for quotes shorter than a small fixed length; both constants are tuned against the corpus and the corpus gates changes to them. Below the threshold the annotation is reported as orphaned per ADR 0010.
- Highlights are drawn with the CSS Custom Highlight API where it exists and with an overlay of positioned elements elsewhere. The guest never wraps or otherwise modifies the host page's text nodes. The guest watches the anchoring root for mutations and re-anchors and redraws after changes.
- Selection is observed through `selectionchange` with a debounce, so keyboard and assistive-technology selections are handled like pointer selections.
- Recogito is not a dependency of the guest. Its `selectorReviveFn` integration and our W3C adapter remain in the trial as a documented alternative.
- The corpus and harness in `packages/guest/corpus/` and `packages/guest/trial/` become the guest's regression suite. When the guest exists it is added as a candidate; a `guessed` verdict on any `mustNotMatch` annotation fails the build (success criterion 5).

## Consequences

- We maintain about 1,200 lines of anchoring code and write selection handling, two renderers, a spatial index for hit testing and mutation tracking ourselves. The trial's highlight module and the Hypothesis guest's `highlighter` and `selection-observer` are the references.
- The guest has no dependency on a single-maintainer library; the only runtime dependency the anchoring adds is `approx-string-match`.
- Re-anchoring quality is bounded by the matcher's thresholds, which trade recall against false anchors. Users will see some orphans on heavily edited pages (two in this corpus at the chosen threshold) rather than silently wrong highlights.
- Browsers without the CSS Custom Highlight API get the overlay, whose layout tracking (scroll on every scrolling ancestor, `ResizeObserver`) is our work and is covered by the nested-scroll case.
- Forced-colors mode needs an explicit `::highlight` style with a text decoration, verified on Windows before the pilot.
- A manual screen-reader pass (VoiceOver, NVDA) is still owed before the Phase 4 exit; the automated checks cover the accessibility tree, tab order and forced colours only.
- The corpus must be re-described when the guest moves to the Phase 1 text model; its `select` and `expected` inputs are written so that only the generated selectors change.

## References

- [Trial report](../../packages/guest/trial/results/summary.md), [harness](../../packages/guest/trial/README.md), [corpus](../../packages/guest/corpus/README.md)
- [Highlight rendering evaluation](../../packages/guest/trial/highlight-rendering.md), [keyboard and screen-reader check](../../packages/guest/trial/keyboard-and-screen-reader.md)
- [Analysis note: In-page guest](../web-annotation-replacement.md#3-in-page-guest); [Project plan: Phase 2](../web-annotation-plan.md#phase-2-guest-trial-23-weeks-parallel-with-phase-1)
- ADR 0007, 0008, 0010, 0012, 0013
- [Hypothesis client](https://github.com/hypothesis/client) at `a7b7400d0d70`; [Recogito Text Annotator](https://github.com/recogito/text-annotator-js) 4.3.7; [CSS Custom Highlight API](https://www.w3.org/TR/css-highlight-api-1/)
