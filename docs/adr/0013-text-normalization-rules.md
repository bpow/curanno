# 0013. Text normalization: collapse whitespace, `br` is a line feed, no block separators, hidden and excluded content omitted

**Status:** Accepted

**Date:** 2026-10-29

## Context

Beyond the offset unit (ADR 0012), the text model has to say what the text of an HTML scope is. The reviewed implementations differ: Hypothesis reads `br` as a space and keeps source whitespace; Apache Annotator and Recogito read `foo<br>bar` as `foobar`; Recogito skips content marked not annotatable; none excludes hidden content or inserts block separators. Each rule trades readability of quotes against determinism across implementations that have different knowledge of the page: a browser knows computed styles, a server-side or import implementation knows only markup.

Options considered for each point are in the [text model specification](../text-model.md). The main tension was block separators: inserting a line feed between block elements gives readable quotes across paragraphs and better full-text search, but whether an element is a block depends on the stylesheet, so a markup-only implementation and a browser would disagree on every offset after a restyled element.

## Decision

- Runs of collapsible whitespace (space, tab, line feed, carriage return, form feed) become one space, and nothing at the start or end of the text or next to a line feed, following CSS white-space processing. Preformatted content (`pre` and friends, or `white-space: pre`, `pre-wrap`, `break-spaces`) is kept verbatim; `pre-line` keeps line feeds only. No-break space is an ordinary character.
- `br` produces one line feed. No other element produces a character; block elements add no separators.
- Content is excluded, with its descendants, when it is `head`, `script`, `style`, `template` or `noscript`; has the `hidden` attribute; has `aria-hidden="true"`; has `data-annotatable="false"`; or has computed `display: none`. Nothing else about style excludes content.
- Text is NFC-normalized per run within a text node.
- A top-level text selector is scoped to the body; a refining selector is scoped to the element its outer selector identifies. Offsets are never scoped to an implicit reference element.

## Consequences

- Quotes read like the rendered page rather than the source, and survive re-indentation and re-wrapping of the source.
- Offsets depend on computed style only through `display: none` and `white-space`. The guest must supply computed values to the text model; a markup-only implementation uses inline styles and agrees with the browser whenever stylesheets do not hide or preformat content.
- Quotes that cross a block boundary run the words together (`onetwo`). This is accepted for determinism; quotes rarely cross blocks, and the sidebar can render them with the stored selectors' structure if needed later.
- `aria-hidden="true"` content cannot be annotated even when it is visible. Pages that misuse the attribute on real content will surprise users, which is preferable to including icon ligatures and duplicated text in quotes.
- The fixture suite fixes every rule; changing one is a breaking change of the specification.

## References

- [Text model specification](../text-model.md)
- [CSS Text Module Level 3, white-space processing](https://www.w3.org/TR/css-text-3/#white-space-processing)
- ADR 0010, ADR 0012
