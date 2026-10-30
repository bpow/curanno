# Anchoring regression corpus

Saved pages and PDFs, each with a set of annotations stored as W3C selectors and one or more edited versions of the document. The trial harness in [`../trial`](../trial/README.md) anchors every annotation against every version with each candidate implementation and reports what happened. Once the guest is built, the same corpus runs on every change to it (plan, section 8).

## Layout

```
corpus/
  README.md
  cases/
    <case-id>/
      case.json          the case: variants, annotations, selectors, expectations
      original.html      the document as annotated (or original.pdf)
      <variant>.html     edited versions (or .pdf)
      app.tsx | app.ts   optional: a framework app the harness bundles to app.js
      src/*.html         optional: sources that `corpus:pdf` renders to the PDFs
```

Every case has a variant with id `original`. Selectors are always generated against it.

## case.json

```jsonc
{
  "id": "synth-overlap",                 // equals the directory name
  "title": "Overlapping and discontiguous selections",
  "kind": "html",                        // or "pdf"
  "source": { "url": "...", "license": "CC BY-SA 4.0", "note": "..." },
  "tags": ["synthetic", "overlap", "mustNotMatch"],
  "root": "#root",                       // optional anchoring root (CSS). Default: body; "#viewer" for PDFs
  "variants": [
    { "id": "original", "file": "original.html", "description": "As written" },
    { "id": "edited", "file": "edited.html", "query": "data=2", "description": "What changed" }
  ],
  "annotations": [
    {
      "id": "vote-b",
      "description": "Short quote whose number changes in the edit",
      "partOf": "permissions",           // optional: groups parts of a discontiguous selection
      "select": { "exact": "Four members supported it", "occurrence": 1, "scope": "#acl + p" },
      "expected": {
        "edited": { "exact": "Five members supported it", "prefix": "...", "suffix": "..." }
      },
      "selectors": [ /* generated, see below */ ]
    }
  ]
}
```

- **`select`** is the authoring input: the text of the original variant that the annotation covers, as the `occurrence`th (1-based, default 1) occurrence of `exact` inside the element matched by `scope` (default: the root). `exact` is matched against `textContent`, so a quote across a `<br>` or a PDF line break has no separator at the break, and a quote across source lines inside a paragraph contains the newline.
- **`selectors`** are generated from `select` by `pnpm --filter @scale/guest corpus:describe` and committed. Three selectors are stored per annotation:
  - `TextQuoteSelector` with `exact` and 32 characters of `prefix` and `suffix`;
  - `TextPositionSelector` with `start` and `end`;
  - `RangeSelector` whose `startSelector` and `endSelector` are `XPathSelector`s of the form `/article[1]/p[2]` relative to the root, each `refinedBy` a `TextPositionSelector` giving the character offset within that element. (The W3C model's shape, not the Hypothesis client's `startContainer`/`startOffset` shape; the harness converts for that candidate.)
- **`expected`** says, per variant, what the right answer is. A missing entry means `select.exact` should be found. `{ "exact": "..." }` names changed text that the annotation should now cover; `prefix` and `suffix` disambiguate when the text occurs more than once in that variant. `{ "mustNotMatch": true, "reason": "..." }` means the text is gone and anything returned is a wrong anchor.
- **`partOf`** marks the parts of one discontiguous selection (W3C: one annotation, several targets). Each part is anchored and counted on its own.

Annotations may also carry hand-written `selectors` without running `corpus:describe` (the PLOS decoy does this to store selectors from another document).

## Text model used by the corpus

Offsets are UTF-16 code units into the anchoring root's `textContent`, in document order, with hidden and excluded content counted and nothing substituted for `<br>`. That is the model the candidates under trial share (Hypothesis and Recogito both count UTF-16 units; Recogito additionally skips `.not-annotatable` subtrees, which the `synth-hidden` case exposes), so each candidate is measured on its own terms.

The project's text model (ADR 0012 and ADR 0013 from Phase 1) is different: code points of NFC text, CSS-like whitespace collapsing, `<br>` as a line feed, and hidden, `aria-hidden` and `data-annotatable="false"` content excluded. When the guest is built on `packages/model`'s text model in Phase 4, teach `trial/src/browser/text.ts` to describe and locate through that implementation and regenerate the selectors with `corpus:describe --force`. The `select` inputs and `expected` texts are plain strings of the visible text and do not depend on the offset unit, so the corpus survives the change; only the generated `selectors` are replaced.

## Cases

| Case | Kind | Source | Covers |
| --- | --- | --- | --- |
| `wp-en-web-annotation` | real | English Wikipedia, three revisions (2026, 2024, 2023), CC BY-SA 4.0 | Real edit history, reference renumbering, table rows added, see-also entry added (`mustNotMatch` in older revisions) |
| `wp-ja-emoji` | real | Japanese Wikipedia 絵文字, two revisions, CC BY-SA 4.0 | Japanese text, emoji with variation selector, navbox added later (`mustNotMatch`) |
| `wp-ar-www` | real | Arabic Wikipedia, two revisions, CC BY-SA 4.0 | Right-to-left Arabic, long page, duplicate phrase disambiguated by context, synonym added later (`mustNotMatch`) |
| `mdn-textcontent` | real + synthetic edits | MDN `Node.textContent`, CC BY-SA 2.5 | Page with navigation and sidebar, code blocks, light and heavy rewrites, removed section (`mustNotMatch`) |
| `gutenberg-pride-prejudice` | real + synthetic edit | Project Gutenberg #1342, public domain | Long document (735k characters), global punctuation change, header removal shifting every offset (`mustNotMatch` on the removed header) |
| `pdf-plos-ten-rules` | real | PLOS Computational Biology editorial, CC BY 4.0 | Two-column PDF text layer, hyphenated line breaks, decoy from another paper (`mustNotMatch`) |
| `pdf-generated-report` | synthetic | Rendered with Chromium from `src/` | PDF with a real second edition: counts corrected, paragraph inserted so text crosses page boundaries, item removed (`mustNotMatch`) |
| `synth-overlap` | synthetic | | Overlapping selections, a selection across a heading boundary, a discontiguous three-part selection, deleted paragraph and list item (`mustNotMatch`) |
| `synth-hidden` | synthetic | | `display:none` menus, visually hidden links, `hidden` span inside a quote, `aria-hidden` glyph, `<noscript>`, `<details>`, `<br>` inside a quote, `.not-annotatable` toolbar |
| `synth-unicode` | synthetic | | Emoji sequences (ZWJ, skin tones, flags), Devanagari, Thai, Arabic, ligatures, combining marks; edits insert emoji before and inside quotes |
| `synth-duplicates` | synthetic | | A section deleted while near-identical headings, sentences and table cells remain: five `mustNotMatch` annotations and two controls |
| `synth-scroll` | synthetic | | Text deep inside nested `overflow: auto` containers |
| `react-rerender` | synthetic | React 19, bundled at build time | Client-rendered list; variants: a forced remount with new keys, and an edited dataset with items added, removed, reordered and reworded |
| `vue-rerender` | synthetic | Vue 3, bundled at build time | The same data and page structure rendered by Vue |

Real pages were fetched on 2026-10-29. Scripts, external stylesheets and image sources were removed so the pages load offline without network requests; everything else, including hidden elements and inline `<style>` blocks inside the content, is as served. Wikipedia pages are the MediaWiki parser output of the named revisions wrapped in a minimal page; their `<meta name="corpus-*">` tags record the revision and license.

## Adding a case

1. Create `cases/<id>/` with `case.json`, `original.html` (or `.pdf`) and the edited variants. For PDFs, put HTML sources under `src/` and run `pnpm --filter @scale/guest corpus:pdf`.
2. Write `select` for each annotation and `expected` for every variant where the right answer is not the original text.
3. Run `pnpm --filter @scale/guest corpus:describe <id>` to fill in `selectors`, then `pnpm --filter @scale/guest trial <id>`. An `invalid` verdict means an expectation could not be located uniquely; add `prefix` or `suffix` to it.
4. Commit the case with its generated selectors.

## Licenses

Each case's `source.license` names the license of the saved content. Wikipedia text is CC BY-SA 4.0 and MDN text CC BY-SA 2.5; the edited variants of those pages are derivative works under the same licenses, made for testing. The PLOS article is CC BY 4.0 and unmodified. Project Gutenberg's text is public domain in the United States; the edited variant removes the Project Gutenberg header, which the Project Gutenberg License permits for the public-domain text when the trademark is not used. Synthetic pages are this project's own. React and Vue (both MIT) are bundled from npm at build time and are not stored here.
