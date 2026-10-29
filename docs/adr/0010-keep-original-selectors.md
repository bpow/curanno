# 0010. Keep original selectors and represent anchoring failures explicitly

**Status:** Accepted

**Date:** 2026-10-29

## Context

Annotated pages change. When a stored selector no longer matches, a client can fail to anchor, match the wrong text, or find several candidates. A tempting shortcut is to re-anchor by fuzzy matching and then overwrite the stored selectors with the new location. If the fuzzy match was wrong, this locks in the error and destroys the evidence needed to recover. The W3C model has no built-in notion of an orphaned or repaired annotation, so this has to be our own design.

## Decision

- The selectors recorded when an annotation is created are stored permanently and are never regenerated automatically. Clients never silently rewrite a target because a page changed.
- The data model represents anchoring state explicitly: anchored, orphaned (no acceptable match), ambiguous (several candidates), and repaired by a user. A repair records the new selectors alongside the originals and who made the change.
- Clients report orphaned and ambiguous anchors to the user rather than guessing, and offer manual repair.

## Consequences

- Wrong anchors cannot be baked in by the system itself; the original evidence survives every page change.
- Users see orphans, which is honest but visible. Re-anchoring quality (the Phase 2 trial) determines how often that happens.
- The target model is more complex than a plain W3C target: it carries anchoring state and possibly two generations of selectors. The OpenAPI document and the sidebar must both handle this.
- Repairs are user actions subject to the `update` permission, so sharing rules affect who can fix an orphan.
- Clients re-run anchoring on every load rather than trusting a cached result, which costs time on long documents.

## References

- [Analysis note: Selectors and the text model](../web-annotation-replacement.md#2-selectors-and-the-text-model)
- [W3C Web Annotation Data Model: Selectors](https://www.w3.org/TR/annotation-model/#selectors)
