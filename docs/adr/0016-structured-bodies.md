# 0016. Structured bodies as an embedded `StructuredBody` validated by a profile registry

**Status:** Accepted

**Date:** 2026-10-29

## Context

Requirement 2 asks for annotation bodies carrying structured data, validated. The W3C model offers no embedded JSON body: the choices are a `TextualBody` whose `value` is a JSON string with `format: application/json`, an external resource identified by IRI, or an extension type. A JSON string inside JSON is awkward for editors and for querying with JSONB; external resources would need a second store. The model does allow extension body types, and a body with an unknown type is still a valid annotation to other clients.

We also need a way to say which schema a body must satisfy. The analysis note proposed keying on the body's `purpose` or on a profile.

## Decision

- An extension body type `StructuredBody` with `profile` (the IRI of a registered profile) and `value` (any JSON). The terms are defined in the platform's JSON-LD extension context.
- A registry of profiles, each binding a JSON Schema 2020-12 to a profile IRI and optionally to purposes. Built-in profiles ship in `packages/model`; administrators can register more through the API; the database holds the union.
- The server validates every `StructuredBody` on write with the same Ajv instance that validates requests, and rejects unknown profiles rather than storing unvalidated data. A JSON `TextualBody` whose purpose maps to a profile is validated the same way, so purpose-keyed validation remains available.
- The sidebar uses the same registry code and the schemas it fetches from the server to validate before submitting and to build editors.
- Details are in [docs/body-profiles.md](../body-profiles.md).

## Consequences

- Structured data is queryable with JSONB operators, and the `profile` column is indexed for search.
- Clients outside this platform see an unknown body type; the data is still JSON they can read, but they cannot validate it without fetching the profile.
- Profiles are versioned by IRI; changing a schema incompatibly means a new profile and a data migration.
- The registry is one more thing to seed at server start and to keep consistent between built-in code and database rows; the `builtin` flag marks which is which.
- Rejecting unknown profiles makes the system strict by default. A deployment that wants to accept arbitrary structured data must register a permissive profile.

## References

- [docs/body-profiles.md](../body-profiles.md)
- [W3C Web Annotation Data Model, Embedded Textual Body](https://www.w3.org/TR/annotation-model/#embedded-textual-body)
- ADR 0003
