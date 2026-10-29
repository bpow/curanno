# Body profiles

How structured annotation bodies are described and validated. Implemented in `packages/model/src/profiles/`, stored in the `body_profiles` table, and exposed through the `/x/profiles` endpoints ([ADR 0016](adr/0016-structured-bodies.md)).

## 1. Structured bodies

The W3C model allows a body to be any resource. For data our tools produce and consume, this platform defines one embedded body type:

```json
{
  "type": "StructuredBody",
  "profile": "https://scale.example/profiles/evidence-excerpt/1",
  "purpose": "classifying",
  "value": { "kind": "case", "identifiers": ["PMID:12345"] }
}
```

- `profile` is the IRI of a registered profile, which binds a JSON Schema to the body's `value`.
- `value` is any JSON value that the profile's schema accepts.
- `purpose`, `id`, `creator`, `created` and `modified` work as on `TextualBody`.

`StructuredBody` and `profile` are terms in the platform's JSON-LD extension context (`EXTENSION_CONTEXT` in the model package). Clients that do not know the extension see a body with an unknown type and a JSON value, which the W3C model permits.

A `TextualBody` with `format: "application/json"` is still accepted. If its `purpose` is one a profile is registered for, its `value` is parsed and validated against that profile; otherwise it is stored as opaque text.

## 2. Profiles

A profile is:

| Field         | Meaning                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `iri`         | Identifies the profile. By convention it ends in a version number (`.../evidence-excerpt/1`); a breaking schema change is a new profile, not an edit. |
| `title`, `description` | For listings and editors                                                                         |
| `schema`      | JSON Schema 2020-12 for `value`. Compiled by the same Ajv instance that validates requests (ADR 0003).   |
| `purposes`    | Optional purposes that select this profile for JSON textual bodies that name no profile                  |

Two sources feed the registry:

- **Built-in profiles** in `packages/model/src/profiles/builtin.ts`, compiled into every deployment and upserted into `body_profiles` with `builtin = true` at server start. They cannot be edited or deleted through the API.
- **Registered profiles** created by an administrator through `PUT /x/profiles/{iri}`, stored in `body_profiles`.

`GET /x/profiles` lists both so that the sidebar can build editors from the schemas, and so that any client can see what a server accepts.

## 3. Validation

On every create or replace of an annotation, the server validates each body:

1. A `StructuredBody` is validated against the profile named by `profile`. An unregistered or disabled profile is rejected with 422 and a problem detail naming the profile: unknown data is not stored silently.
2. A JSON `TextualBody` whose purpose maps to a profile is parsed and validated the same way; invalid JSON is rejected.
3. Every other body is accepted unchanged.

Errors are returned in the `errors` array of the problem detail with Ajv-style `instancePath` values rooted at the body (`/value/kind`), so editors can point at the offending field.

The sidebar runs the same registry client-side, with the schemas it fetched from `/x/profiles`, so users see errors before submitting.

## 4. Querying

`bodies.profile` is a generated column from `body->>'profile'`, indexed, so `GET /x/search?profile=` is an index lookup. Fields inside `value` can be queried through the GIN index on `bodies.body` with containment (`body @> '{"value": {"kind": "case"}}'`); exposing field queries through the API is deferred until a profile needs it.

## 5. The proof-of-concept profile

`evidence-excerpt/1` classifies an excerpt as evidence of a kind (`case`, `functional`, `segregation`, `population`, `computational`, `other`), with CURIEs for the entities it concerns, an optional confidence and summary. It demonstrates the registry end to end and is expected to be replaced or extended by the curation team's own profiles; its schema is in `builtin.ts` and its tests in `registry.test.ts`.

## 6. Adding a profile

1. Write the JSON Schema. Keep `additionalProperties: false` so that typos in field names are caught.
2. For a built-in profile, add it to `builtinProfiles` with a test; for a deployment-specific one, `PUT` it as an administrator.
3. Document the fields where users will see them: the sidebar's editor for the profile.
4. Never change a published schema incompatibly. Register `.../name/2` and migrate bodies if needed.
