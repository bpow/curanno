# Text model specification

**Version 0.1.0.** This document defines how an HTML document becomes the text that `TextQuoteSelector` and `TextPositionSelector` refer to, and how offsets in that text map back to positions in the document. Every part of the platform that produces or consumes text selectors follows it: the guest, the server, and any import tooling. The reference implementation is `packages/model/src/text-model/`; the fixture suite in `packages/model/fixtures/text-model/` is the normative test of conformance, and third-party implementations are expected to run it.

The versioning rule from [CONTRIBUTING.md](../CONTRIBUTING.md) applies: a change that alters the normalized text or offsets of any existing fixture is a breaking change and requires a major version bump.

## 1. Why a text model

The W3C Web Annotation Data Model defines `TextQuoteSelector` and `TextPositionSelector` over "the text" of a resource but leaves open what that text is for HTML: which content counts, how whitespace is treated, and how line breaks appear. Implementations differ (see the analysis note, [Selectors and the text model](web-annotation-replacement.md#2-selectors-and-the-text-model)), and two implementations that disagree shift annotations silently. This specification fixes the answers.

Design goals, in priority order:

1. **Determinism across implementations.** Two conforming implementations given the same tree produce the same text and offsets. Rules depend on markup wherever possible, and on computed style only where ignoring it would be clearly wrong.
2. **Interoperability with the W3C model.** Offsets count Unicode code points of NFC-normalized text, as the W3C specification requires.
3. **Readable quotes.** The quoted text should look like what the user selected, without runs of source indentation.

## 2. Terms

- **Scope**: the element whose descendants' text is being counted. Offsets are relative to the scope's normalized text, which starts at offset 0.
- **Normalized text**: the string produced from the scope by the rules in sections 4 to 7.
- **Boundary point**: a text node and a UTF-16 offset into its character data, as in a DOM `Range`.
- **Code point**: one Unicode scalar value. Characters outside the Basic Multilingual Plane are one code point and two UTF-16 code units.

## 3. Offset unit

Offsets in `TextPositionSelector` (`start`, `end`) and context lengths count **Unicode code points** of the normalized text. `start` is the offset of the first character of the selection and `end` is the offset after its last character, so `end - start` is the selection's length in code points. See [ADR 0012](adr/0012-code-point-offsets.md).

DOM APIs count UTF-16 code units. The conversion happens at the boundary between the text model and the DOM, through the map described in section 8, and never by re-counting a quote.

## 4. Scope

- A selector that is the direct `selector` of a target is scoped to the **document's body element** (`document.body`). Head content is therefore excluded.
- A selector that refines another selector (`refinedBy`) is scoped to the element the outer selector identifies. For a `CssSelector` or `XPathSelector` this is the matched element. For a PDF target, the outer selector is a `FragmentSelector` naming a page (section 10) and the scope is that page's text.
- The scope element is treated like any other element: if it is itself excluded under section 5, its normalized text is empty.

Scoping a text selector to a smaller element is the only supported way to make offsets independent of unrelated page changes. Implementations never record an implicit "offset reference" element that is not in the selector itself.

## 5. Excluded content

An element and all of its descendants contribute no text when any of the following holds for the element or for any ancestor up to and including the scope:

| Condition                                                         | Rationale                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The element is `head`, `script`, `style`, `template` or `noscript` | Never rendered as document text                                                     |
| It has the `hidden` attribute (any value)                         | Hidden by HTML semantics, whatever the stylesheet says                               |
| It has `aria-hidden="true"`                                       | Marked as not part of the document's meaning; the accessible text omits it           |
| It has `data-annotatable="false"`                                 | Explicitly marked as not annotatable, by the page or by the annotation client itself |
| Its computed `display` is `none`                                  | Not rendered                                                                         |

Comments, processing instructions and other non-element, non-text nodes contribute nothing and do not separate text.

`visibility: hidden`, `opacity: 0`, clipping and off-screen positioning do **not** exclude content: the text still occupies layout and is part of the document.

An implementation that knows computed styles (a browser) must use them for `display`. An implementation that only has markup (a parser, the fixture runner) uses the element's inline `style` attribute, with the last declaration of a property winning. Fixtures only use inline styles, so both kinds of implementation agree on them.

Only `aria-hidden="true"` exactly excludes content. Other values, including `false`, do not.

## 6. Line breaks and element boundaries

- A `br` element produces exactly one line feed (U+000A) in the normalized text. The line feed is a character of the text and can be included in a selection.
- No other element produces any character. In particular, block elements do **not** add separators: `<p>one</p><p>two</p>` normalizes to `onetwo`. Whether an element is a block depends on the stylesheet, and a rule based on it would make every offset after a restyled element implementation-dependent. See [ADR 0013](adr/0013-text-normalization-rules.md).
- `wbr`, `img`, `input` and other void or replaced elements produce nothing. Alternative text is not part of the text model.

## 7. Whitespace

Whitespace is processed as CSS `white-space` processing would, minus line wrapping, so that the normalized text reads like the rendered page rather than the source.

**Collapsible whitespace** is any of U+0020 space, U+0009 tab, U+000A line feed, U+000D carriage return and U+000C form feed, in content whose white-space mode is `normal`, plus the same characters except line feed in `pre-line` content. No-break space (U+00A0) and all other Unicode whitespace are ordinary characters and are never collapsed.

The **white-space mode** of a text node is that of its nearest ancestor that sets one, or `normal`:

| Source                                                   | Mode       |
| -------------------------------------------------------- | ---------- |
| Computed or inline `white-space: pre`, `pre-wrap`, `break-spaces` | `pre`      |
| Computed or inline `white-space: pre-line`               | `pre-line` |
| Computed or inline `white-space: normal`, `nowrap`       | `normal`   |
| Element `pre`, `textarea`, `listing`, `plaintext`, `xmp` with no overriding style | `pre` |

Rules:

1. A maximal run of collapsible whitespace, which may span several text nodes and element boundaries, becomes **one space (U+0020)**, except that it becomes **nothing** when it is at the start of the normalized text, at the end of it, or adjacent to a line feed on either side.
2. In `pre` content every character is kept as is. A line feed in `pre` or `pre-line` content is kept and counts as a line feed for rule 1.
3. Carriage returns are collapsible in `normal` and `pre-line` content; HTML parsing has already turned CR LF into LF, so they are rare.

Because rule 1 spans element boundaries, `<p>one </p> <p> two</p>` normalizes to `one two`, not `one   two`.

## 8. Unicode normalization

The normalized text is in **Unicode Normalization Form C**, as the W3C model requires. Normalization is applied to each run of non-collapsible characters within one text node. Consequences:

- A combining sequence split across two text nodes (the base in one, the mark in the next) is not composed. In practice such splits do not occur in parsed HTML.
- Where NFC changes the number of code points (a decomposed `e` + U+0301 becomes one `é`), the characters of a run that changes are treated as one unit for boundary mapping: a boundary point inside such a unit maps to the unit's start when it is a range start and to its end when it is a range end.

Quote matching (section 9) normalizes the stored `exact`, `prefix` and `suffix` to NFC before comparing, so selectors created from non-normalized text still match.

## 9. Boundary points and the text map

An implementation produces, together with the normalized text, a map from offsets to boundary points and back. The map is a sequence of segments in document order; each segment covers a contiguous range of the text and refers to one text node (or one `br` element) with a range of its UTF-16 offsets.

Mapping a boundary point to an offset:

- In copied text, the offset is the segment's start plus the number of code points between the segment's node start and the point.
- In a collapsed whitespace run that became a space: a point at the run's start maps to the space's offset; any other point in the run maps to the offset after the space.
- In a dropped whitespace run: every point maps to the offset where the run would have been.
- In a run changed by NFC: the start maps to the start, the end to the end, interior points as in section 8.
- A point in excluded content has no offset. A range with such an endpoint cannot be described and the client reports it as not annotatable.

Mapping an offset to a boundary point is the inverse. An offset that is both the end of one segment and the start of the next belongs to the following segment for a range start and to the preceding segment for a range end. A line feed from `br` has no text node; an offset at it resolves to the end of the preceding text for a range start and to the start of the following text for a range end.

## 10. Selectors

Describing a text range produces both selectors; a target stores both.

- `TextPositionSelector`: `start` and `end` as in section 3.
- `TextQuoteSelector`: `exact` is the normalized text of the range. `prefix` is the up to **32 code points** of normalized text before the range and `suffix` the up to 32 after it; each is omitted when empty. The context length 32 is part of this specification; implementations that create annotations use it, and implementations that match annotations accept any length.

Resolving a `TextPositionSelector` yields the text between its offsets. A client must compare that text with the stored `exact` before using the position, and treat a mismatch as a failed anchor, never as a reason to rewrite the selector ([ADR 0010](adr/0010-keep-original-selectors.md)).

Matching a `TextQuoteSelector` finds every occurrence of `exact` in the normalized text and ranks them by how many code points of `prefix` (from its end) and `suffix` (from its start) match the surrounding text, then by distance from the stored position when there is one. Whether to accept the best candidate when the context does not fully match, and any fuzzy matching, is the client's decision and is outside this specification.

## 11. PDF documents

For PDF targets, the outer selector is a `FragmentSelector` with `conformsTo` `http://tools.ietf.org/rfc/rfc3778` and `value` `page=N` (1-based), refined by the text selectors. The scope is the page's text as produced by the PDF.js text layer: the text items of the page in content order, joined with the whitespace PDF.js inserts between items, and then normalized by sections 7 and 8 as `normal` white-space content. Fixtures for PDF text are added with PDF support (plan Phase 5); until then this section is informative.

## 12. Fixture suite

`packages/model/fixtures/text-model/` holds one JSON file per case: an HTML input with marked ranges, the expected normalized text, and the expected selectors for each range. The format is described in the suite's [README](../packages/model/fixtures/text-model/README.md). The suite covers whitespace collapsing, preformatted content, `br`, each exclusion rule, block boundaries, comments, non-Latin scripts, right-to-left text, astral characters and emoji sequences, NFC composition including Hangul, no-break spaces, document boundaries, context truncation and ambiguous quotes.

A conforming implementation passes every fixture: its normalized text equals `text`, describing each marked range yields the expected selectors (or fails for ranges marked `null`), resolving each position yields the quote, and searching for each quote ranks the marked occurrence first.

## 13. What implementations receive and return

In code, the model is expressed as (names from the reference implementation):

- `extractText(scope, adapter)` returns the normalized text and the map. The adapter answers structural questions about nodes so that the same code runs over a browser DOM, a DOM library in tests, or a parser's tree; a browser host supplies computed `display` and `white-space`.
- `textOffsetFromPoint` and `pointFromTextOffset` convert between boundary points and offsets.
- `describeRange`, `resolvePosition` and `findQuote` implement section 10.
- `codePointLength`, `codePointToUtf16` and `utf16ToCodePoint` convert units where a host must.
