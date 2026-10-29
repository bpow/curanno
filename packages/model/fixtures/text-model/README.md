# Text model fixtures

Test vectors for the text model specified in [docs/text-model.md](../../../../docs/text-model.md). Any implementation of the model, in any language, should pass them. The reference implementation in `packages/model/src/text-model/` runs them in `fixtures.test.ts`.

Each file is one case:

```json
{
  "name": "basic",
  "description": "What the case exercises.",
  "html": "<p>Hello ⟦r1⟧world⟦/r1⟧</p>",
  "text": "Hello world",
  "ranges": {
    "r1": {
      "quote": { "type": "TextQuoteSelector", "exact": "world", "prefix": "Hello " },
      "position": { "type": "TextPositionSelector", "start": 6, "end": 11 }
    }
  }
}
```

- `html` is parsed as an HTML fragment, or as a whole document when it starts with a doctype or `<html>`. The scope is the fragment's container, or the body element of a whole document.
- Range markers `⟦name⟧` and `⟦/name⟧` (U+27E6 and U+27E7) sit inside text content. An implementation removes them before normalizing and records the boundary point each one stood at. They never appear in `text`.
- `text` is the expected normalized text of the scope.
- For each range, `quote` and `position` are the selectors expected from describing the range with the default context length of 32 code points. `prefix` and `suffix` are omitted when empty. A value of `null` means the range cannot be described because it lies in content that contributes no text.

An implementation should also check that resolving `position` against `text` yields `exact`, and that searching for `quote` in `text` ranks the marked occurrence first.
