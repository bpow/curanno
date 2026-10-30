# Highlight rendering: wrapped elements, overlay spans, CSS Custom Highlight API

Part of the Phase 2 guest trial. Measured by `pnpm --filter @scale/guest trial:highlights` on the corpus pages that re-render their DOM (`react-rerender`, `vue-rerender`) and on the nested-scroll page (`synth-scroll`); raw numbers in [`results/highlights.json`](results/highlights.json). The recommendation is recorded in [ADR 0017](../../../docs/adr/0017-guest-base-and-highlight-rendering.md).

## The three techniques

| | Wrapped elements | Overlay spans | CSS Custom Highlight API |
| --- | --- | --- | --- |
| How | Split the text nodes at the range ends and wrap the covered pieces in an element (`<mark>` here; the Hypothesis client uses `<hypothesis-highlight>`) | Measure the range's client rects and draw absolutely positioned `<div>`s in a layer appended to the container, with `pointer-events: none` (Recogito's `SPANS` renderer, used as shipped) | Register the live `Range` objects in `CSS.highlights` and style them with `::highlight(name)`; no DOM change |
| DOM changes | Text nodes split and moved; one element per text node touched (7 to 9 elements for 6 annotations on these pages) | One layer element plus one element per rendered rect; text untouched | None |
| Browser support | Universal | Universal | Chromium 105+, Safari 17.2+, Firefox 140+ (2025); older browsers get no highlight |
| Hit testing | Native: the element receives events | Needs a spatial index (Recogito uses rbush) and `elementFromPoint`-style lookup on the container's events | No events on the highlight; needs the same spatial lookup as the overlay |
| Styling | Any CSS | Any CSS, but only as a box behind the text (blend mode to keep text legible) | Colour, background, text decoration, shadow only |

## Pages that re-render their DOM

Both framework pages render the same issue list. Three operations were applied after drawing highlights for six annotations:

- **patch**: the app switches to dataset 2 in place. Rows keep their index keys, so the framework updates text nodes it already owns and, for the first issue, inserts a `<strong>` element before the body text.
- **remount**: the app re-renders dataset 1 with new keys, so every element is replaced by a new one with the same text.
- **redraw**: what a guest would do next: re-anchor the stored selectors against the new DOM and draw again.

| Page | Technique | Drawn | After patch | After remount | After redraw | Text intact after patch | Console errors |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| React 19 | wrap | 6/6 | 2/6 | 1/6 | 6/6 | **no** | 0 |
| React 19 | overlay | 6/6 | 1/6 | 1/6 | 6/6 | yes | 0 |
| React 19 | CSS highlight | 6/6 | 1/6 | 1/6 | 6/6 | yes | 0 |
| Vue 3 | wrap | 6/6 | 2/6 | 1/6 | 6/6 | **no** | 0 |
| Vue 3 | overlay | 6/6 | 1/6 | 1/6 | 6/6 | yes | 0 |
| Vue 3 | CSS highlight | 6/6 | 1/6 | 1/6 | 6/6 | yes | 0 |

"Drawn" counts annotations whose text has highlight-coloured pixels over it in a screenshot. "Text intact" compares the root's `textContent` with a clean render of the same dataset.

What happened:

- **No technique keeps highlights across a re-render.** After a patch or remount the highlights are gone or stale for all three (the one or two that remain are on text the framework did not touch). The guest has to notice DOM changes (a `MutationObserver` on the root, debounced) and re-anchor and redraw; after that all three are back to 6/6. This is the same for every candidate base.
- **Wrapping corrupts the page under an in-place patch, silently.** With `<mark>` elements in the paragraph, React and Vue both updated the text nodes they held references to and inserted the new `<strong>` before them, leaving the wrapped text node from the previous render in place. The first issue's paragraph then ended with a sentence from the second issue, with no console error in either framework. The overlay and the CSS highlight leave the text nodes alone, so the frameworks' patches land cleanly.
- **Remounts are harmless for all three.** When every node is replaced, wrapped highlights disappear with the old nodes and the new text is clean; overlay rects go stale; `Range`s in `CSS.highlights` collapse onto detached nodes and stop painting.

The insertion-before-wrapped-text pattern is ordinary: a conditional badge, an icon, a mention component, a "new" marker in a list item. Pages the team wants to annotate (documentation sites, journal platforms, single-page applications) are increasingly rendered this way, which is why the Hypothesis client's wrapping approach is the one to move away from.

## Nested scrolling containers

`synth-scroll` places text inside an `overflow: auto` panel inside another scrolling panel. After drawing, the inner panel was scrolled by 120 px and the outer by 80 px, then the viewport was resized.

| Technique | Drawn | After nested scroll | After resize | Overlay distance from text (px) |
| --- | ---: | ---: | ---: | --- |
| wrap | 3/3 | 3/3 | 3/3 | – |
| overlay (Recogito) | 2/3 | 2/3 | 0/3 | after scroll 179 to 1683; after resize 200 to 2102 |
| CSS highlight | 3/3 | 3/3 | 3/3 | – |

Wrapped elements and CSS highlights are part of the text, so they move with it. Recogito's overlay keeps a spatial index of rects measured relative to the container and refreshes it on window scroll and resize; a scroll inside a nested container moves the text and not the highlights, and an annotation outside the panel's initial visible area was not drawn at all. Fixing this means listening to `scroll` on every scrolling ancestor (capture phase) and to `ResizeObserver` on the container, then re-measuring every visible annotation; the cost grows with the number of annotations on screen. The native techniques get this for free.

## Accessibility (from `trial:a11y`, detail in [keyboard-and-screen-reader.md](keyboard-and-screen-reader.md))

- The accessibility tree is unchanged by the overlay and by CSS highlights; wrapping inserts `mark` nodes (Chromium exposes `<mark>` with the `mark` role, and screen readers may announce "highlighted"). None of the three adds tab stops.
- In forced-colors mode (Windows high contrast) `<mark>` keeps a system highlight colour; the overlay and the CSS highlight disappear, and in this measurement `forced-color-adjust: none` did not bring them back. A guest using either must provide a forced-colors style of its own (for example a text decoration through `::highlight`, which forced colors does keep) and test it on Windows.

## Recommendation

Use the **CSS Custom Highlight API** as the primary technique and keep an **overlay** as the fallback for browsers without it. Do not wrap text.

- The CSS highlight is the only technique with no DOM footprint, which is what protects framework-rendered pages, and it tracks nested scrolling and reflow for free. Its styling limits (no borders, no padding) are acceptable for highlights; the hover and selected states can be expressed with colour and text decoration.
- The overlay is needed for Firefox before 140 and older Safari, and it is already written in Recogito. Its nested-scroll weakness is a tracking problem the guest's layout code must solve for the overlay path only.
- Both techniques need the same spatial index for hit testing, since neither puts an element under the pointer. That index is also what the sidebar uses to scroll to and flash an annotation, so it is not extra work for the highlight alone.
- Whatever the technique, the guest re-anchors and redraws after DOM mutations. The corpus's framework pages become the regression test for that behaviour.
- Forced-colors support is an explicit item for Phase 4: a `::highlight` style with `text-decoration` and a check on Windows high contrast.
