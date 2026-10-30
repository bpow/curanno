# Document identity

How the platform decides which document an annotation belongs to, so that annotations made on one URL are found when the same document is opened at another. The rules are implemented in `packages/model/src/document-identity/` and stored by the `documents` and `document_uris` tables ([ADR 0014](adr/0014-document-identity.md)).

## 1. The problem

The same document is reached through many URLs: with and without tracking parameters, over `http` and `https`, through a short link, a publisher's canonical link, a DOI, or as a PDF downloaded from several places. Annotations must follow the document, not the URL. At the same time, different documents must not be merged by accident: a wrong `rel=canonical` is common on the web and would silently show one page's annotations on another.

## 2. Model

A **document** is a row in `documents`. Every URI known to identify it is a row in `document_uris`, with:

| Column                | Meaning                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `uri`                 | The URI as the page reported it                                                       |
| `uri_normalized`      | Its canonical form (section 3), the lookup key. Unique across all documents.          |
| `relation`            | How the URI was learned (section 4)                                                   |
| `claimant_normalized` | The page URL that asserted the relation, for untangling bad canonicals                |

The invariant is that a normalized URI belongs to at most one document. Lookup is therefore one indexed query, and two documents that turn out to share a URI must be merged (section 6).

Targets keep the `source` IRI exactly as the client sent it; the document link is derived, not substituted.

## 3. URL canonicalization

`canonicalizeUri` produces the lookup key. It is never used to fetch anything or shown to users.

For `http` and `https` URLs:

1. Parse as a WHATWG URL; unparseable input identifies nothing.
2. The scheme becomes `https`. Sites move between the two and serve the same content on both; the original scheme survives in `uri`.
3. Host is lower-cased and IDNA-encoded, and the default port removed (the URL parser does this).
4. Credentials and the fragment are removed.
5. In the path, percent-encoded unreserved characters are decoded and remaining escapes are upper-cased. Dot segments are resolved by the parser. Trailing slashes are kept: `/a/` and `/a` stay different, since servers may serve different resources.
6. Query parameters whose names start with `utm_`, and a fixed list of click identifiers (`fbclid`, `gclid`, `dclid`, `msclkid`, `yclid`, `igshid`, `mc_cid`, `mc_eid`, `_ga`, `_gl`, `_hsenc`, `_hsmi`), are removed. The remaining parameters are sorted by name then value. An empty query is removed.

Other schemes:

- `doi:` names are lower-cased; `https://doi.org/...` and `dx.doi.org` forms are accepted as input to `canonicalizeDoi` and produce the same key.
- `urn:` identifiers keep their namespace lower-cased; `urn:x-pdf:` fingerprints are lower-cased entirely.
- Any other scheme (`mailto`, `javascript`, `about`, `file`, ...) identifies nothing.

What is deliberately not done: stripping `www.`, removing `index.html`, treating `/a/` and `/a` as equal, or decoding the query. Each would merge resources that are sometimes distinct.

## 4. Identifiers a page reports

The client collects the following from the page and sends them as `DocumentMetadata` to `POST /x/documents` before creating an annotation. `deriveDocumentUris` turns them into `(uri, normalized, relation)` triples.

| Relation          | Source                                                        | Normalized form                                                                               |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `self`            | The page URL                                                  | Section 3                                                                                     |
| `pdf_fingerprint` | PDF.js fingerprint of a PDF                                   | `urn:x-pdf:<fingerprint>` lower-cased                                                         |
| `canonical`       | `<link rel="canonical">`                                      | Resolved against the page URL, then section 3                                                 |
| `doi`             | `<meta name="citation_doi">` or another DOI the client found | `doi:<name>` lower-cased                                                                      |
| `dc_identifier`   | `<meta name="dc.identifier">`                                 | With `dc.relation.ispartof`: `urn:x-dc:<ispartof>/<identifier>`, both percent-encoded. Without: a DOI or absolute URI is used as such; anything else becomes `urn:x-dc:<identifier>`. |
| `og_url`          | `<meta property="og:url">`                                    | As `canonical`                                                                                |
| `shortlink`       | `<link rel="shortlink">`                                      | As `canonical`                                                                                |
| `pdf_url`         | `<meta name="citation_pdf_url">`                              | As `canonical`                                                                                |
| `alternate`       | Reserved for `<link rel="alternate">`; not emitted            | `rel=alternate` usually points at feeds, AMP copies or translations, which are not the same document |

The table order is the precedence: when two sources give the same normalized URI, the first relation is recorded.

Guards:

- A link that does not resolve to an `http` or `https` URL is ignored.
- A link whose normalized form is a site root (`https://host/` with no query) is ignored. Templates that put the home page in `rel=canonical` or `og:url` on every page are common, and accepting them would merge a whole site into one document.
- A page whose own URL identifies nothing (`about:blank`, a `file:` URL) can still be identified through its other identifiers.

The `urn:x-pdf:` and `urn:x-dc:` forms follow the Hypothesis conventions so that identifiers are comparable with that system's data if we ever import it.

## 5. Lookup

Given a page's derived set `S` of normalized URIs:

```sql
select distinct document_id from document_uris where uri_normalized = any($1)
```

- No match: create a document with every URI in `S`.
- One match: add to it any URI in `S` not yet recorded.
- Several matches: the page's own URI's document is used when it is known, otherwise the oldest match; URIs in `S` that already belong to another document stay there, and the conflict is logged. Documents are never merged on a client's say-so (section 6).

Search by URI (`GET /x/search?uri=`) normalizes the query URI, resolves it to a document through the same table, and returns that document's annotations. A URI that matches no document yields no results rather than an error.

## 6. Merging

When one page reports URIs belonging to two or more documents, the documents may well be the same, but the page is also the only witness, and any authenticated user can serve a page. Merging on that evidence would let one request fold two unrelated documents into one for everybody, irreversibly (security review, finding 2). So the server records the conflict in its log (the chosen document, the others, the claimant page and the URIs) and does not merge; an operator who has established that the documents are one merges them by hand with `mergeDocuments` in `apps/api/src/documents/service.ts`, which in one transaction:

1. Keeps the oldest document.
2. Re-points `annotations.document_id`, `targets.document_id` and `document_uris.document_id` of the others to it, and deletes the others.
3. Writes an `annotation_events` row of kind `updated` for each re-pointed annotation so that open sidebars refresh.

Merging is irreversible by design; the guards in section 4 and the `claimant_normalized` column exist so that a bad merge can be diagnosed and repaired by hand.

## 7. PDF documents

A PDF's identity is its PDF.js fingerprint, which is derived from the file's trailer ID or, failing that, a hash of its first kilobyte, so the same file downloaded from two places is one document. The URL it was loaded from is recorded as `self` so that it can also be found by URL. The same PDF fingerprint seen under a new URL extends the existing document rather than creating one.

## 8. What clients must do

- Report the page URL and every identifier in section 4 that the page exposes, exactly as found; normalization happens in the model package on both sides and in the server.
- Use the `id` returned by `POST /x/documents` only for display and search; targets name the page URL as `source`.
- Never invent identifiers from page content.
