# Keyboard and screen-reader check

Part of the Phase 2 guest trial. Automated checks were run with `pnpm --filter @curanno/guest trial:a11y` in headless Chromium (raw output in [`results/a11y.json`](results/a11y.json)); the rest comes from reading the candidates' code. No screen reader was driven during this trial; the manual pass that remains is listed at the end.

## What each candidate does with a selection

**Recogito Text Annotator 4.3.7.** The selection handler listens to `pointerdown`/`pointerup`, `selectstart` and `selectionchange`, and binds hotkeys for `Shift+Arrow` (all four) and `Ctrl/⌘+A`. A selection made with the keyboard is turned into an annotation when **Shift is released** over a non-collapsed selection. Measured on the React page:

| How the selection was made | Annotation created |
| --- | --- |
| Programmatically (`setBaseAndExtent`), no key or pointer events | no (0) |
| Programmatically, then `Shift+ArrowRight` and Shift released | yes (1) |
| Mouse drag | yes (1) |

So keyboard selection works when the user extends a selection with Shift and the arrow keys, which is how caret browsing (F7 in Chromium and Firefox) and most keyboard selection works. A selection placed by assistive technology without key events (some screen readers' "select text" commands, or a browser extension) is not picked up. Recogito also sets `tabindex="-1"` on the container and adds `no-focus-outline`, so the annotated container can receive programmatic focus without becoming a tab stop. The `createTextAnnotator` options expose no keyboard shortcut to move between highlights.

**Hypothesis client (anchoring vendored; selection code reviewed, not run).** The guest's `SelectionObserver` watches `selectionchange` with a debounce and `mousedown`/`mouseup` to avoid reacting mid-drag, so keyboard and assistive-technology selections are picked up as soon as they settle, with no key release required. Highlights are `<hypothesis-highlight>` elements with no role; focus and keyboard navigation between annotations live in the sidebar, which also announces anchoring state. That split (nothing focusable in the page, everything operable in the sidebar) is what ADR 0007 commits us to anyway.

**Recogito with the quote fallback** is the same as Recogito for everything in this document: the fallback changes re-anchoring only.

## What each highlight technique does to the accessibility tree

Measured on the first article of the React page with three annotations drawn (tab stops counted by pressing Tab until focus repeats).

| Technique | Accessibility tree changed | Highlight elements | Tab stops before → after | Visible in forced-colors mode | With `forced-color-adjust: none` |
| --- | --- | --- | --- | ---: | ---: |
| Wrapped `<mark>` | yes: `mark` nodes split the paragraph's text | `mark` | 2 → 2 | 3/3 | 3/3 |
| Overlay (Recogito `SPANS`) | no | `div` (layer and rects, `pointer-events: none`) | 2 → 2 | 0/3 | 0/3 |
| CSS Custom Highlight | no | none | 2 → 2 | 0/3 | 0/3 |

Notes:

- A `mark` in the tree is a mixed blessing: VoiceOver and NVDA can announce "highlighted" at the start and end, which tells a screen-reader user an annotation is there, but splitting a sentence into three text nodes can also cause a pause mid-sentence depending on the reader. Overlay and CSS highlights are invisible to screen readers: the user learns about an annotation only through the sidebar.
- Forced-colors mode removes author backgrounds. `<mark>` keeps the system `Mark` colour; the overlay and the CSS highlight vanish and opting out with `forced-color-adjust: none` did not restore them here (Recogito sets the overlay colour inline; the `::highlight` background was dropped too). A text decoration through `::highlight()` is the usual remedy and must be verified on Windows.
- None of the techniques makes anything focusable, so none of them changes keyboard navigation of the host page. That also means keyboard users cannot "activate" a highlight in the page; the sidebar must list annotations and scroll to them.

## Conclusions for Phase 4

1. Selection: handle `selectionchange` with a debounce (the Hypothesis approach) rather than requiring a Shift release, so selections made by assistive technology count. If Recogito is the base, this means supplying our own selection handling or filing an upstream change; its hotkey list is otherwise sound.
2. Highlights: keep them out of the accessibility tree (overlay or CSS highlight) and make the sidebar the keyboard surface: a list of annotations in document order, with Enter scrolling the page to the anchor and a live region announcing anchoring state (anchored, orphaned, ambiguous).
3. Expose a per-page summary to assistive technology in the page itself: a visually hidden live region owned by the guest ("3 annotations on this page, 1 could not be placed") is cheap and does not touch the host page's content.
4. Provide a forced-colors style for highlights and test it on Windows high contrast.

## Manual pass still to do

Before the pilot (Phase 4 exit), run through the corpus pages with VoiceOver on macOS and NVDA on Windows: make a selection by keyboard, create an annotation from the sidebar, move to the next annotation, and confirm the orphan announcement. Record the findings against this document.
