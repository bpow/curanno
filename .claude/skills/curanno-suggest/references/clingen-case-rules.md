# ClinGen's rules for case annotation

These rules come from ClinGen's *Hypothes.is Annotation Overview* and its *Baseline Annotation Template Protocol Review* (January 2021). Their wording is quoted. CurAnno's profiles follow ClinGen's Case-Individuals template, so the same rules apply.

## Which cases

- A case is "an individual asserted to have a variant in the gene of interest". Annotate a person only when the authors say they carry a variant in that gene.
- "Each Case report listed in an article should be curated as a separate annotation." For example, four individuals with a variant in the gene give four individuals. In CurAnno that means four `individual` items, each with its own facts.
- If the article reports no one with a variant in the gene, there is nothing to suggest. Say so, and post nothing.

## What to record

- "Annotate only what is indicated by the authors."
  - Where ClinGen writes "n/a", leave the field out.
  - Do not infer a phenotype from a diagnosis, a zygosity from a pedigree, or an inheritance pattern from a family.
- The disease is the authors' assertion: "annotate based on the assertion given by the authors". If they assert no disease, make no disease fact.
- Inheritance, including de novo status, is "based solely on the assertions of the author".
- Germline versus somatic is likewise as the authors assert it.
- Use "clear, concise and complete sentences" in free-text fields.

## Individuals and labels

- Use the label the article gives the individual ("Patient 1", "II-1", "the proband"). Add sex, age and ethnicity as the article states them; ClinGen's `Case` field is "the Individual label, sex, age, ethnicity if known".
- **Previously published individuals.** A proband published before gets "PreviouslyPublished", with the PMID when the article gives it. When a whole cohort was published before, note that once, on the passage that says so.
- **Supplementary data.**
  - A case reported only in the supplement cannot be quoted from the article text. List it in `notInBatch` with the file or table.
  - If the main text mentions the individual, record them there, and put the supplement's file or table in `supplementalData`.

## Phenotypes

- `CasePresentingHPOs` are "the HPOs presenting specifically in the proband of interest".
- `CaseNOTHPOs` are "the HPOs that were noted not to manifest", so only phenotypes the article says are absent or normal. Never list a phenotype as absent merely because it is not mentioned.
- Phenotypes without a fitting HPO term are kept as text. This is ClinGen's `CaseHPOFreeText` and `CaseNOTHPOFreeText`.

## Variants

- Use HGVS nomenclature as the article gives it, with its transcript where stated.
- "For autosomal recessive inheritance of compound mutations, you will need to separate variant entries." Compound heterozygous variants are therefore separate `case-variant` facts.
- "If mutations in other genes are listed, please annotate all variants in the report." A variant in another gene is a `case-variant` fact with that gene's `geneName`.
- **ClinVar and CAID.** Record a ClinVar ID or a CAID yourself only if the article states it, with `idSource: "stated"`. Never look one up yourself or write one from memory. The `resolve` step looks the rest up in the Allele Registry and fills only unambiguous answers; curators choose among the others, or register the variant.
- **gnomAD.** "The highest minor allele frequency … and the link." Record it only if the article states a gnomAD frequency or ID.

## Tags ClinGen uses that have no CurAnno field yet

The protocol tags these with fixed values:

- `Zygosity:*`
- `InheritancePattern:*`
- `Mutation:Germline` and `Mutation:Somatic`
- `Mutation:<type>`
- `PreviousTesting:Performed`, `None` and `Undetermined`
- `UnregisteredVariant`

Record what the authors say about these in words, in the nearest field:

- zygosity and germline or somatic status in the variant's `variantEvidence`;
- inheritance in `familyInfo`;
- testing status in `casePreviousTesting`.
