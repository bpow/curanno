/** A few HPO classes in OBO Graphs form, shaped like a real hp.json release. */
const obo = (id: string) => `http://purl.obolibrary.org/obo/${id.replace(':', '_')}`;
const node = (id: string, lbl: string, synonyms: [string, string][] = [], deprecated = false) => ({
  id: obo(id),
  lbl,
  type: 'CLASS',
  meta: {
    synonyms: synonyms.map(([pred, val]) => ({ pred, val })),
    ...(deprecated ? { deprecated: true } : {}),
  },
});
const isA = (sub: string, obj: string) => ({ sub: obo(sub), pred: 'is_a', obj: obo(obj) });

export const hpoFixture = {
  graphs: [
    {
      id: 'http://purl.obolibrary.org/obo/hp.json',
      meta: {
        version: 'http://purl.obolibrary.org/obo/hp/releases/2026-09-01/hp.json',
        basicPropertyValues: [
          { pred: 'http://purl.org/dc/elements/1.1/title', val: 'Human Phenotype Ontology' },
          { pred: 'http://www.w3.org/2002/07/owl#versionInfo', val: '2026-09-01' },
          { pred: 'http://purl.org/dc/terms/license', val: 'https://hpo.jax.org/app/license' },
        ],
      },
      nodes: [
        node('HP:0000001', 'All'),
        node('HP:0000118', 'Phenotypic abnormality'),
        node('HP:0000005', 'Mode of inheritance'),
        node('HP:0000006', 'Autosomal dominant inheritance'),
        node('HP:0001638', 'Cardiomyopathy'),
        node('HP:0001639', 'Hypertrophic cardiomyopathy', [
          ['hasExactSynonym', 'HCM'],
          ['hasExactSynonym', 'Enlarged and thickened heart muscle'],
          ['hasBroadSynonym', 'Heart disease'],
        ]),
        node('HP:0009999', 'Obsolete cardiac thing', [], true),
        node('GO:0007507', 'heart development'),
        { id: 'http://purl.obolibrary.org/obo/hp#layperson', type: 'PROPERTY' },
      ],
      edges: [
        isA('HP:0000118', 'HP:0000001'),
        isA('HP:0000005', 'HP:0000001'),
        isA('HP:0000006', 'HP:0000005'),
        isA('HP:0001638', 'HP:0000118'),
        isA('HP:0001639', 'HP:0001638'),
        isA('HP:0009999', 'HP:0001638'),
        isA('GO:0007507', 'HP:0000001'),
      ],
    },
  ],
};
