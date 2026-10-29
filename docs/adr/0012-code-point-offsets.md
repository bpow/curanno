# 0012. Text offsets count Unicode code points

**Status:** Accepted

**Date:** 2026-10-29

## Context

`TextPositionSelector` offsets and the context lengths of `TextQuoteSelector` need a unit. The W3C Web Annotation Data Model counts characters of NFC-normalized text, which are Unicode code points. JavaScript strings and DOM `Range` offsets count UTF-16 code units, and for that reason Hypothesis and Recogito store code-unit offsets. Apache Annotator follows the specification. The two units agree until the first character outside the Basic Multilingual Plane (most emoji, some CJK characters, mathematical alphanumerics), after which every later offset differs.

The choice affects interoperability with other W3C clients and with data we might import, and it affects where conversion happens in our own code.

## Decision

Offsets in stored selectors count **Unicode code points** of the normalized text, as the W3C model specifies. The guest converts between DOM UTF-16 offsets and code points at its boundary, through the text map that the text model produces, and never by re-counting quoted text. The context recorded in `TextQuoteSelector` is 32 code points on each side.

## Consequences

- Annotations are portable to and from any client that follows the W3C model without conversion.
- Data imported from Hypothesis or Recogito needs its positions converted once, against the source document; the quote selector makes this checkable.
- Every place that touches DOM offsets must go through the conversion helpers. The text model package provides them and the fixture suite includes astral characters so a missed conversion fails a test.
- Conversion costs a binary search per offset over the positions of astral characters, which is negligible.

## References

- [W3C Web Annotation Data Model, TextPositionSelector](https://www.w3.org/TR/annotation-model/#text-position-selector)
- [Text model specification](../text-model.md), section 3
- [Analysis note: Selectors and the text model](../web-annotation-replacement.md#2-selectors-and-the-text-model)
