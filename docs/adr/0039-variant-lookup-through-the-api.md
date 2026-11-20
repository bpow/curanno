# 0039. Variant IDs are looked up through the API in the ClinGen Allele Registry

**Status:** Proposed

**Date:** 2026-11-19

## Context

ClinGen's case template asks for a ClinVar Variation ID or an Allele Registry ID (CAID) for each variant. Articles rarely give either, and they describe variants in many forms: HGVS on an old transcript, a cDNA change with no transcript, a protein change only. Curators look IDs up by hand in several sites. The suggester skill is told never to fill these fields, so that a model does not invent IDs (docs/claude-skills-plan.md, section 8).

Unlike HPO (ADR 0031), the data cannot reasonably be imported: the registry holds billions of alleles, and mapping between transcripts and genome builds needs reference sequences. So the lookup has to call an outside service.

The options considered for where the call is made:

- **From the browser.** The sidebar's `connect-src` would have to allow the registry, and the suggester would need its own copy of the logic.
- **Through the API.** One implementation for the sidebar and the suggester, one cache for all curators, and a single place where a deployment turns it off.

For the source:

- **ClinVar E-utilities.** Search by HGVS matches words, not alleles, and returns other variants at the same position.
- **The ClinGen Allele Registry.** Allele lookup needs no account, it normalises HGVS, and each allele links its ClinVar Variation, gnomAD and dbSNP records. It does not know old transcript versions.
- **VariantValidator.** It maps old transcript versions to the genome, but does not give IDs.

For recording a variant with no IDs to find, the case-variant profile could gain `/2`, or add an optional field to `/1`.

The pattern is not specific to variants. An article names something in its own words, and an authority gives it an ID: a gene symbol in HGNC, a chemical in PubChem, a cell line in Cellosaurus, an antibody by its RRID. An endpoint, a schema keyword and a response named after variant fields would each need a copy for the next lookup.

## Decision

- The API serves `GET /x/resolve/{resolver}?q=&<context>` to authenticated callers. `variant` is the first resolver, and its context is `gene`. It asks the Allele Registry, and VariantValidator only when the registry does not know the reference sequence. Context parameters are declared on the one operation, so the contract validates them, and a resolver ignores context it does not use. An unknown resolver, or one turned off, answers 404, and an outside service that fails answers 502.
- Every resolver answers with the same shape, and never chooses for the curator:

  ```json
  {
    "query": "c.1208G>A",
    "context": { "gene": "MYH7" },
    "candidates": [{
      "label": "NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)",
      "fill": { "caid": "CA010365", "clinVarId": "14087", "gnomad": "14-23429278-C-T" },
      "facts": [{ "label": "CAID", "values": [{ "text": "CA010365", "url": "https://…" }] }],
      "autoFill": true,
      "warnings": []
    }],
    "warnings": [{ "code": "transcript-assumed", "message": "…" }],
    "steps": [{ "service": "Allele Registry", "request": "NM_000257.4:c.1208G>A", "outcome": "found CA010365" }]
  }
  ```

  - `fill` holds the values a candidate gives, under names the resolver documents. For `variant` these are `caid`, `clinVarId` and `gnomad`, and `clinVarId` is given only when ClinVar has a single variation.
  - `facts` is what an editor shows, with links. A fact with no values reads as "none".
  - `autoFill` marks the one candidate a program may fill without asking a curator. Each resolver defines when, so that the rule lives with the knowledge it needs rather than in each client.
  - Warning codes are part of the contract, but each resolver lists its own, so the shared schema types `code` as a string.
- A profile asks for lookup with the `lookup` keyword on a string property:

  ```json
  "lookup": {
    "resolver": "variant",
    "context": { "gene": "geneName" },
    "fill": { "caid": "caid", "clinVarId": "clinVarId", "gnomad": "gnomad" },
    "ids": ["caid", "clinVarId"],
    "source": "idSource"
  }
  ```

  - `context` maps each context parameter to the sibling field that gives it.
  - `fill` maps each name in a candidate's `fill` to the sibling field it fills.
  - `ids` lists the fields that identify the mention, and defaults to every `fill` field. A mention needs lookup while all of them are empty and `source` is not `unresolvable`, and marking it unresolvable clears them. `gnomad` is left out for `variant`: a gnomAD ID alone does not satisfy the ClinGen template.
  - `source` names the field that takes `looked up` or `unresolvable`.
- The sidebar, the management site and the suggester read the keyword, not field names.
- The `suggestions:write` token scope (ADR 0038) allows the lookup, so the suggester can fill IDs in a batch.
- Results are cached in memory for a day. A deployment can turn the lookup off with `VARIANT_LOOKUP=off`.
- CurAnno does not register alleles. An unregistered candidate links to the registry.
- `case-variant/1` gains an optional `idSource` field (`stated`, `looked up`, `unresolvable`). The change is made to `/1` because it is additive: every stored body still validates, and a reader that ignores the field reads the IDs as before. The rule in docs/body-profiles.md is against incompatible changes, and this is not one. A reader that validates new bodies against an old copy of the schema would reject the field. No such reader is known.

## Consequences

- Variant descriptions, which are public, and the gene of interest go to reg.genome.network and rest.variantvalidator.org. Document text and annotations do not. Operators must allow these hosts, or turn the lookup off.
- The lookup depends on services we do not run. When they are down, the editor says so and curators type IDs by hand as before.
- Each API replica has its own cache. That is enough while one replica serves the API.
- A new resolver is a server module behind the `Resolver` interface (`apps/api/src/resolvers.ts`), its context parameters in the OpenAPI operation, and a `lookup` keyword in a profile. The editors need no change, and show `facts` as given without knowing what they describe.
- Facts can now say where their IDs came from, and that a variant has none, so that later lists of variants without IDs leave out the ones curators have given up on.

## References

- [docs/variant-ids-plan.md](../variant-ids-plan.md)
- [ClinGen Allele Registry](https://reg.clinicalgenome.org)
- [VariantValidator REST API](https://rest.variantvalidator.org)
- ADR 0016, ADR 0031

