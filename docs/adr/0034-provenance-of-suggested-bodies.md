# 0034. A suggested body names the model as its creator

**Status:** Accepted

**Date:** 2026-11-13

## Context

An annotation the curator accepts from a suggestion (ADR 0032) should say that a model proposed its structured body. Other systems reading it should find that where the W3C Web Annotation Data Model puts provenance.

The model defines `creator`, `created` and `modified` (`dcterms:`) on the annotation and on each body, and allows several creators "when multiple agents may have worked together". It defines `generator` (`as:generator`) on the annotation only, as "the agent responsible for generating the serialization", which is the client software. The model and its vocabulary do not use PROV-O.

The options considered:

- **Annotation-level `generator` naming the model.** It is in the expected place, but it means something else: it would claim the model wrote the serialization.
- **Body-level `generator`.** This is not in the W3C model, so it needs an extension term, and it would still borrow the serialization meaning.
- **Store the model's suggestion as its own annotation, with the curator's annotation `assessing` it.** This is the most idiomatic W3C pattern. But suggestions would have to be stored, given ACLs and searched, which is more than the feature needs.
- **Body-level `creator`.** Chosen.

## Decision

- The annotation's `creator` stays the curator, as the server assigns it from the token.
- A structured body accepted from a suggestion has `creator` set to the model, as a `Software` agent: `{"type": "Software", "name": "curanno-extract", "nickname": "<model> / prompt <PROMPT_VERSION>"}`. Its `created` is the time the suggestion was made.
- If the curator changed the value before saving, the body's `creator` also lists the curator as a `Person`, using the user's IRI on this server (`<api>/x/users/<id>`).
- Editing the annotation later keeps the body's `creator` as it was. The sidebar carries it through the draft.
- Other bodies (a comment, tags) are written by the curator alone and carry no `creator`, as before.
- `generator` is not used for the model.

## Consequences

- Readers that follow the W3C model find the model in the body's `creator`, with no extension needed.
- The server stores the body's `creator` as the client sent it, while the annotation's `creator` comes from the server. So the record that a model was involved is the client's claim. This is fine for provenance, but it should not be relied on for access control.
- `Agent` has few fields. If a prompt version, a run identifier or an endpoint needs to be recorded more precisely later, PROV-O terms (`prov:wasGeneratedBy`) can be added to the extension context next to the body's `creator`, without replacing it.

## References

- [W3C Web Annotation Data Model, 3.3.1 Lifecycle Information and 3.3.2 Agents](https://www.w3.org/TR/annotation-model/#lifecycle-information)
- [Web Annotation Vocabulary](https://www.w3.org/TR/annotation-vocab/)
- ADR 0016, ADR 0032
