# case-variant

One fact per variant per statement. Quote the sentence or table text that reports the variant for these individuals.

- **`geneName`**: the HGNC symbol, the gene of interest or another gene.
- **`variant`** (required): as the article gives it, preferring HGVS with its transcript, for example "NM_000257.4:c.1208G>A (p.Arg403Gln)". Keep the protein change in brackets when the article gives both. Do not normalize or correct a variant's nomenclature: a curator checks it.
- **`clinVarId`**: digits only, and only if the article states it.
- **`caid`**: `CA` followed by digits, and only if the article states it.
- **`idSource`**: `"stated"` when you record a `clinVarId` or `caid` the article gives. Leave it out otherwise: the `resolve` step sets `"looked up"` when it fills IDs. Use `"unresolvable"` only for a variant that has no HGVS form at all, such as a deletion described only by its exons or a copy-number change.
- **`gnomad`**: a gnomAD frequency or variant ID, only if the article states one, for example "absent from gnomAD" or "MAF 0.00002 (gnomAD)". The `resolve` step may add the gnomAD ID.
- **`variantEvidence`**: what the authors say about the variant itself:
  - zygosity (heterozygous, homozygous, hemizygous, compound heterozygous);
  - germline or somatic, and de novo where asserted;
  - segregation stated for this variant;
  - in-silico predictions;
  - functional studies.

  Keep it to what the authors state, in a sentence or two.

Compound heterozygous variants are two facts, one per variant, and `variantEvidence` says "compound heterozygous" on each. Variants in other genes reported for the same individual are facts too.
