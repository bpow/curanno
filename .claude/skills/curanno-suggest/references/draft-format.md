# The draft batch

`draft.json` is what you write and `check` reads:

```json
{
  "article": "PMC1234567",
  "gene": "MYH7",
  "engine": { "model": "<your model id>", "skill": "curanno-suggest", "version": "1" },
  "items": [
    { "id": "_:i1", "kind": "individual", "passage": 12, "quote": "…", "value": { "case": "…" } }
  ],
  "notInBatch": ["…"]
}
```

- **`gene`** is the draft's gene of interest, as an HGNC symbol. The `resolve` step uses it for any `case-variant` without a `geneName`.
- **`id`** is the item's local id: `_:` followed by letters, digits, `-` or `_`. Use `_:i1`, `_:i2` … for individuals, and any other ids for facts. A fact's link field (`individuals`) lists local ids of `individual` items in the same draft.
- **`kind`** is a kind's short name, as `kinds` prints it.
- **`passage`** is the number of the passage the quote is from, as `text` prints it. It only helps messages point at the right place.
- **`article`** is the `id` that `text` printed: a PMC id, a DOI, a URL or a `urn:x-pdf:` fingerprint.
- **`quote`** is copied exactly from that passage: whole sentences, never joined across passages, never shortened, and with no added or changed characters. Differences in whitespace and typographic quotes or dashes are tolerated; anything else is not. The quote must also be unique in the article, so quote enough to tell repeated sentences apart.
- **`value`** follows the kind's schema from `kinds`. Phenotype lists take labels (strings), which `check` resolves to HPO terms.
- **`notInBatch`** lists, for the curator, what you found but could not put in the batch.

## What `check` reports

`check` prints JSON and exits 1 while there are problems.

- **`problems`**: each has `item`, an optional `path`, and `message`. Every one must be fixed.

  | Message | Meaning |
  | --- | --- |
  | "the quote is not in the article word for word" | Copy the sentence again, exactly, from the passage named. |
  | "the quote is not on any one page word for word" (a PDF) | Copy it again from the page named, with its hyphens, and split a sentence that runs onto the next page. |
  | "the quote occurs more than once" | Quote more of the sentence, or a neighbouring clause. |
  | "the quote is too short" | Quote at least a whole sentence. |
  | "there is no kind …" or "… is computed from facts" | Use a kind `kinds` lists, other than `case-individual`. |
  | "no item _:x in this batch", or "_:x is not a … item" | A link names a missing item, or one of the wrong kind. |
  | "says the same as _:y on the same quote" | A duplicate; drop it, or merge the two. |
  | A schema message with a `path` such as `value/idSource` | `idSource` is not `stated`, `looked up` or `unresolvable`. |
  | A schema message with a `path` such as `value/clinVarId` | The value does not fit, for example a ClinVar ID that is not a number. Fix or drop the field. |

- **`unresolved`**: phenotype labels that matched no HPO term exactly. These are allowed, and are kept as text, but look them up first with `terms hp "<words>"`.
- **`replacedIds`**: HPO ids you gave that the lookup did not confirm. The lookup's term replaces them. Prefer giving labels.
- **`batch`**: present once there are no problems. It is what `post` sends.
