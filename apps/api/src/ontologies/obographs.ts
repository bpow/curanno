/**
 * Reads an OBO Graphs JSON release (the `hp.json` HPO publishes, or any OBO
 * Foundry ontology's `.json`) into the terms the ontology store keeps
 * (docs/ontologies.md).
 */

export interface OntologyTerm {
  /** CURIE, for example HP:0001639. */
  id: string;
  label: string;
  synonyms: string[];
  /** CURIEs of every `is_a` ancestor, the term itself excluded. */
  ancestors: string[];
}

export interface ParsedOntology {
  title: string | undefined;
  version: string | undefined;
  license: string | undefined;
  homepage: string | undefined;
  terms: OntologyTerm[];
}

interface GraphNode {
  id: string;
  lbl?: string;
  type?: string;
  meta?: { deprecated?: boolean; synonyms?: { pred?: string; val?: string }[] };
}

interface Graph {
  meta?: { version?: string; basicPropertyValues?: { pred?: string; val?: string }[] };
  nodes?: GraphNode[];
  edges?: { sub?: string; pred?: string; obj?: string }[];
}

const OBO = 'http://purl.obolibrary.org/obo/';
// Broad and narrow synonyms name other concepts, so matching on them would offer the wrong term.
const SYNONYM_PREDICATES = new Set(['hasExactSynonym', 'hasRelatedSynonym']);
const TITLE = 'http://purl.org/dc/elements/1.1/title';
const VERSION_INFO = 'http://www.w3.org/2002/07/owl#versionInfo';
const LICENSE = 'http://purl.org/dc/terms/license';
const HOMEPAGE = 'http://xmlns.com/foaf/0.1/homepage';

/** `http://purl.obolibrary.org/obo/HP_0001639` → `HP:0001639`, for the ontology's own prefix only. */
function curie(iri: string, prefix: string): string | undefined {
  if (!iri.startsWith(`${OBO}${prefix}_`)) return undefined;
  return `${prefix}:${iri.slice(OBO.length + prefix.length + 1)}`;
}

/**
 * Keep the current classes whose IRIs carry `prefix` (`HP`), so that terms
 * imported from other ontologies are left to their own.
 */
export function parseOboGraph(document: unknown, prefix: string): ParsedOntology {
  const graph = (document as { graphs?: Graph[] }).graphs?.[0];
  if (!graph?.nodes) throw new Error('not an OBO Graphs document: no graphs[0].nodes');
  const property = (pred: string) =>
    graph.meta?.basicPropertyValues?.find((p) => p.pred === pred)?.val;

  const nodes = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    const id = curie(node.id, prefix);
    if (id && node.type === 'CLASS' && node.lbl && !node.meta?.deprecated) nodes.set(id, node);
  }

  const parents = new Map<string, string[]>();
  for (const edge of graph.edges ?? []) {
    if (edge.pred !== 'is_a' || !edge.sub || !edge.obj) continue;
    const sub = curie(edge.sub, prefix);
    const obj = curie(edge.obj, prefix);
    if (!sub || !obj || !nodes.has(sub) || !nodes.has(obj)) continue;
    parents.set(sub, [...(parents.get(sub) ?? []), obj]);
  }

  const closure = new Map<string, Set<string>>();
  const ancestorsOf = (id: string, visiting = new Set<string>()): Set<string> => {
    const known = closure.get(id);
    if (known) return known;
    // A cycle would be an error in the release; stop rather than recurse forever.
    if (visiting.has(id)) return new Set();
    visiting.add(id);
    const all = new Set<string>();
    for (const parent of parents.get(id) ?? []) {
      all.add(parent);
      for (const a of ancestorsOf(parent, visiting)) all.add(a);
    }
    visiting.delete(id);
    closure.set(id, all);
    return all;
  };

  const terms = [...nodes].map(([id, node]) => {
    const synonyms = new Set<string>();
    for (const s of node.meta?.synonyms ?? []) {
      if (s.val && s.pred && SYNONYM_PREDICATES.has(s.pred) && s.val !== node.lbl)
        synonyms.add(s.val);
    }
    return {
      id,
      label: node.lbl as string,
      synonyms: [...synonyms],
      ancestors: [...ancestorsOf(id)].sort(),
    };
  });

  return {
    title: property(TITLE),
    version: property(VERSION_INFO) ?? graph.meta?.version,
    license: property(LICENSE),
    homepage: property(HOMEPAGE),
    terms,
  };
}
