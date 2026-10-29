# 0014. Document identity by a set of normalized URIs, with guarded canonical links and merging

**Status:** Accepted

**Date:** 2026-10-29

## Context

Annotations must be found when the same document is opened at a different URL (tracking parameters, `http` versus `https`, short links, publisher canonicals, DOIs, PDFs downloaded from several places), but different documents must not be merged by accident. `rel=canonical` is frequently wrong on the web, most often pointing at a site's home page. The Hypothesis `html-metadata` and `pdf-metadata` integrations were the reference for which page metadata is worth collecting.

Options considered: identify documents by the page URL only (misses the cases above); by a single canonical identifier chosen per page (loses the other URLs and depends on which one the client picked); or by a set of equivalent URIs with a canonical lookup form and merging when sets overlap.

## Decision

- A document is identified by the set of normalized URIs reported for it. A normalized URI belongs to at most one document; documents found to share one are merged, the oldest surviving.
- Normalization for HTTP URLs: `https` for both schemes, lower-cased IDNA host, default port and fragment and credentials removed, percent-encoding normalized, `utm_*` and a fixed list of click identifiers removed, remaining query parameters sorted. Trailing slashes and `www.` are kept.
- Identifiers collected from a page: its URL, PDF.js fingerprint, `rel=canonical`, DOI, `dc.identifier` (scoped by `dc.relation.ispartof`), `og:url`, `rel=shortlink` and `citation_pdf_url`, in that precedence. `rel=alternate` is not used.
- Guards: links must be `http(s)`, and a link to a site root is ignored. The page that asserted each link is recorded for auditing.
- PDF fingerprints and scoped Dublin Core identifiers use the `urn:x-pdf:` and `urn:x-dc:` forms Hypothesis uses, for comparability.
- The full rules are in [docs/document-identity.md](../document-identity.md); `packages/model/src/document-identity/` implements them for client and server alike.

## Consequences

- Annotations follow documents across URL variants and between a web page and its canonical form or DOI, with one indexed lookup.
- Merging is irreversible. A wrong canonical that passes the guards merges two documents; the recorded claimant lets an operator find and repair it by hand. Operator tooling for splitting documents is deferred.
- Treating `http` and `https` as one document, and sorting query parameters, can in rare cases merge resources a site serves differently. This is accepted as far less common than the opposite failure.
- Every client must report page metadata through `POST /x/documents`; a client that only sends the page URL gets URL-only identity.
- The tracking-parameter list needs occasional maintenance.

## References

- [docs/document-identity.md](../document-identity.md)
- [Analysis note: Server](../web-annotation-replacement.md#1-server), on document identity
- [RFC 3986, section 6](https://www.rfc-editor.org/rfc/rfc3986#section-6), on URI comparison
