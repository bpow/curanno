# 0033. The guest reports its document's text when the sidebar asks

**Status:** Accepted

**Date:** 2026-11-13

## Context

Suggestions (ADR 0032) need the text that selectors refer to: the normalized text of each scope (text model, sections 4–7). Only the guest has the document, and the RPC protocol carried selectors and identity but no text. Its principles (RPC, section 1) are that nothing goes to the page that would hurt if the page read it, that every message is a notification, and that a change to an existing message adds optional fields only.

Text going from the guest to the sidebar tells the sidebar nothing the page does not already have. It is the opposite direction that the principles protect.

## Decision

- `guest.hello`'s capabilities gain an optional `text: true`. The sidebar offers suggestions only for documents whose guest sets it. Guests built before this change, including installed extension builds, leave it out and are not asked.
- The sidebar sends `text.request {requestId}`. The guest answers with `text.report {requestId, scopes}`, where each scope is `{text, page?}`:
  - For an HTML page there is one scope, the body's text.
  - For the PDF viewer there is one scope per page, built from the page's text content (`integrations/pdf-text.ts`), so pages that are not rendered yet are included. `page` is the 1-based page number.
- The sidebar keeps only the latest report for each request id, and drops a report for an id it did not ask for or that came from another guest.
- An anchor request may carry an optional `style: "suggested"`. The guest draws those highlights in a separate, dashed style. Suggestions are anchored under `urn:uuid:` identifiers through the existing `annotations.anchor` and `annotations.unanchor`.
- The protocol version stays 2: every change is either a new optional field or a message type that is only sent to a guest that advertised `text`.

## Consequences

- A page could report text that is not what the user sees. The text model already excludes hidden content when the guest computes styles, and anything else a hostile page does only affects suggestions on that same page, which the curator reviews.
- The report for a long PDF is large: all of its pages, in one message. That is fine for MessageChannel, and it is sent only when the curator asks for suggestions.
- The suggested highlight style is one more thing for both renderers (CSS highlights and the overlay) and for forced-colors mode.

## References

- ADR 0007, ADR 0017, ADR 0021, ADR 0023, ADR 0032
- [Guest/sidebar RPC protocol](../guest-sidebar-rpc.md)
- [Text model](../text-model.md), sections 4–7 and 11
