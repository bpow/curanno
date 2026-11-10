# 0031. Ontology terms for lookup are imported into Postgres and searched through the API

**Status:** Accepted

**Date:** 2026-11-10

## Context

The case-individual profile records phenotypes. Curators know them by name, while the ClinGen template wants HPO IDs, and its separate free-text fields exist because typing IDs by hand is error-prone. An editor that suggests HPO terms as the curator types can store IDs, which are consistent and queryable, without making curators look them up elsewhere.

The options considered for where the suggestions come from:

- **A public search service** (JAX's HPO API, EBI's OLS), called from the browser. There would be no data to host, but the sidebar's `connect-src` would have to allow a third party, every query would leave the deployment, and the tool would depend on a service we don't run.
- **A file bundled with the sidebar.** No server work, but a download of several megabytes for every sidebar user, and a new HPO release would need a rebuild.
- **Our own database and API.** An operator imports a release, and the API searches it.

## Decision

- Ontologies are imported from OBO Graphs JSON with a command-line tool into `ontologies` and `ontology_terms`. Each term keeps its label, its exact and related synonyms and its `is_a` ancestors. An import replaces the previous release in one transaction. The API never writes to these tables.
- `GET /x/ontologies` lists the loaded releases, and `GET /x/ontologies/{name}/terms` searches one by ID, label and synonym. Like `/x/profiles`, both answer anonymous callers.
- A profile asks for lookup with an `ontology` schema keyword (`{name, root?}`) on an array of `{id?, label}` items. A picked term stores its ID and the label it had then; text that matches no term stores only the label. The keyword only annotates and doesn't affect validation.
- The search is a scan with no text index, which is fast enough at HPO's size. `pg_trgm` was not used, so that a managed Postgres need not allow the extension.

## Consequences

- Lookup works offline, everyone on a deployment sees the same release, and no query leaves the deployment.
- Operators have one more step: importing each ontology and rerunning the import for new releases. A deployment without HPO still works; the editor keeps typed text.
- Stored labels are snapshots. A later release that renames or obsoletes a term doesn't change existing annotations, and the server doesn't check that a stored ID exists.
- Each ontology's license is the operator's to meet. HPO's requires attribution, the release version wherever its terms are shown publicly, and no changes to its content or relationships. The importer only selects terms, and `GET /x/ontologies` returns the version for display (docs/third-party-notices.md).
- The case-individual profile stores phenotypes as objects rather than bare IDs, which is a little more verbose but readable without a lookup.

## References

- [docs/ontologies.md](../ontologies.md)
- [docs/body-profiles.md](../body-profiles.md)
- [ADR 0016](0016-structured-bodies.md)
- [OBO Graphs](https://github.com/geneontology/obographs)
