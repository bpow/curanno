# 0030. A profile's default purpose is separate from its purpose mapping

**Status:** Accepted

**Date:** 2026-11-10

## Context

ADR 0016 binds each body profile to an IRI and, optionally, to purposes. The `purposes` list ended up doing two jobs:

- **Selecting a schema.** A `TextualBody` with `format: application/json` names no profile, so the server picks one by the body's purpose. That only works if each purpose selects at most one profile, and `ProfileRegistry.register` enforces this.
- **Labelling new bodies.** The sidebar gave each new `StructuredBody` its profile's first purpose.

The W3C model has 13 purposes, and most profiles fit only a few of them (`describing`, `assessing`, `classifying`). Because of the uniqueness rule, the first profile to claim one of these purposes stopped every other profile from using it as a label. The labelling never worked anyway: `GET /x/profiles` did not return `purposes`, so the sidebar always saw none.

Two ways out were considered. One was to keep a single list and let profiles share a purpose, accepting a JSON textual body that matches any of their schemas. That makes the validation errors unclear, because the server can't tell which schema the body was meant for. The other was to split the two jobs.

## Decision

- A profile has an optional `defaultPurpose`, the purpose clients give a new body of that profile. It does not have to be unique. It is stored in `body_profiles.default_purpose`, returned by `GET /x/profiles` and can be set through `PUT /x/profiles/{iri}`.
- `purposes` only selects a schema for JSON textual bodies, and each purpose still selects at most one profile. Only built-in profiles can set it.
- The sidebar uses `defaultPurpose` alone.

## Consequences

- Any number of profiles can label their bodies `describing` or `assessing`.
- A built-in profile that needs both says so twice (`evidence-excerpt/1` has `defaultPurpose: classifying` and `purposes: [classifying]`). That is redundant, but each field now has one meaning.
- Purpose mappings for profiles registered through the API are still not stored. Supporting them needs a uniqueness check on `PUT`, so that a clashing row cannot stop the registry from loading.

## References

- [ADR 0016](0016-structured-bodies.md)
- [docs/body-profiles.md](../body-profiles.md)
- [W3C Web Annotation Data Model, Motivation and Purpose](https://www.w3.org/TR/annotation-model/#motivation-and-purpose)
