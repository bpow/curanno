# Ontologies

Ontologies the platform loads so that body editors can suggest terms, starting with the Human Phenotype Ontology (HPO) for the case-individual profile's phenotype fields ([ADR 0031](adr/0031-ontology-term-lookup.md)). Implemented in `apps/api/src/ontologies/`.

## 1. Loading a release

An operator imports a release in OBO Graphs JSON, the `.json` file OBO Foundry ontologies publish next to `.obo` and `.owl`:

```bash
curl -LO https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download/hp.json
pnpm --filter @curanno/api ontology import hp hp.json --homepage http://www.human-phenotype-ontology.org
# or, in a pod: node dist/ontologies/cli.js import hp hp.json --homepage http://www.human-phenotype-ontology.org
pnpm --filter @curanno/api ontology list
```

The name is the ontology's CURIE prefix in lower case (`hp` for `HP:0001639`). An import replaces everything stored under that name in one transaction, so it can be rerun for each new release. The API reads ontologies but never changes them. A deployment with no HPO loaded still works: the editor says lookup is unavailable and keeps what users type as text.

The importer keeps:

- current classes whose IRIs have the ontology's own prefix, so terms imported from other ontologies and deprecated terms are left out;
- each term's label and its exact and related synonyms. Broad and narrow synonyms name other concepts, so matching on them would suggest the wrong term;
- every `is_a` ancestor of each term, so that a search can stay within one branch;
- the release's title, version (`owl:versionInfo`) and license IRI, and a homepage (`foaf:homepage`, or `--homepage` for a release like HPO's that names none), which `GET /x/ontologies` returns for attribution.

The same command loads MONDO or any other OBO Foundry ontology.

## 2. Searching

`GET /x/ontologies/{name}/terms?q=&root=&limit=` returns terms whose ID equals `q`, or one of whose names (the label or a synonym) contains every word of `q`, ignoring case. The best matches come first: the ID, then a whole name, a name prefix, a word prefix, and finally a match anywhere in a name. A label ranks before a synonym, and a shorter name before a longer one. When a synonym matched, the result names it. `root` limits the results to that term and its descendants. The phenotype fields use `HP:0000118` (Phenotypic abnormality), which leaves out modes of inheritance, onset and frequency.

There is no text index. A search scans one ontology's names, which takes about 20 ms for HPO's 20,000 terms and 25,000 synonyms on the development database. A trigram index (`pg_trgm`) is the next step if larger ontologies make this slow.

## 3. In profiles

A profile asks for lookup with the `ontology` keyword on an array whose items are `{id?, label}` objects (docs/body-profiles.md). A picked term stores its ID and the label it had when it was picked; text that matches no term stores only `label`. Stored labels are not updated when a later release renames a term.

The server does not check that an `id` exists in the loaded release. The schema checks only its form.

## 4. Licenses

Each ontology has its own license, and the operator who loads it is responsible for meeting its terms. `GET /x/ontologies` returns the license IRI the release names.

HPO's [license](https://hpo.jax.org/license) lets anyone use it on three conditions: the HPO Consortium is acknowledged and cited, any public display of HPO files includes the release date or version, and neither the content nor the logical relationships of the files are altered. It also asks users to add "This service/product uses the Human Phenotype Ontology (version information). Find out more at http://www.human-phenotype-ontology.org" and the HPO logo to their online presence. The importer keeps labels and `is_a` relationships as released and only chooses which terms and synonyms to search, and the API returns the release version for display. The sidebar's term picker shows the statement with the release version, and the homepage given to the import (`--homepage`); the HPO logo is not shown. See docs/third-party-notices.md.
