/**
 * Turning the labels a model gave for ontology fields into the profile's
 * `{id?, label}` items (ADR 0031). The lookup is the caller's: the sidebar
 * searches `/x/ontologies/{name}/terms`, the evaluation CLI may pass none.
 * A label the lookup matches stores the term's ID and label; any other is
 * kept as written and reported, so the editor can point at it.
 */
import type { OntologyLookup } from '@curanno/model';
import type { OntologyField, ValuePath } from './schema.js';

export interface Term {
  id: string;
  label: string;
}

/** Terms for some of `labels`, keyed by the label as given. */
export type ResolveTerms = (
  ontology: OntologyLookup,
  labels: string[],
) => Promise<ReadonlyMap<string, Term>>;

type Holder = Record<string, unknown> | unknown[];

/** Every array at `path` in `value`, with the holder and key to replace it under. */
function arraysAt(value: unknown, path: ValuePath): { holder: Holder; key: string | number }[] {
  const found: { holder: Holder; key: string | number }[] = [];
  const walk = (
    node: unknown,
    rest: ValuePath,
    holder: Holder | undefined,
    key: string | number,
  ) => {
    if (rest.length === 0) {
      if (holder && Array.isArray(node)) found.push({ holder, key });
      return;
    }
    const [head, ...tail] = rest;
    if (head === '*') {
      if (Array.isArray(node)) node.forEach((item, i) => walk(item, tail, node, i));
    } else if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
      const record = node as Record<string, unknown>;
      if (head !== undefined && head in record) walk(record[head], tail, record, head);
    }
  };
  walk(value, path, undefined, '');
  return found;
}

function labelOf(item: unknown): string | undefined {
  if (typeof item === 'string') return item.trim() || undefined;
  if (typeof item === 'object' && item !== null) {
    const label = (item as { label?: unknown }).label;
    if (typeof label === 'string') return label.trim() || undefined;
  }
  return undefined;
}

function keyOf(ontology: OntologyLookup): string {
  return `${ontology.name}\n${ontology.root ?? ''}`;
}

export async function resolveOntologyFields(
  value: unknown,
  fields: readonly OntologyField[],
  resolve?: ResolveTerms,
): Promise<{ value: unknown; unresolved: string[] }> {
  const copy = structuredClone(value);
  const sites = fields.flatMap((field) =>
    arraysAt(copy, field.path).map((site) => ({ ...site, ontology: field.ontology })),
  );
  const byOntology = new Map<string, { ontology: OntologyLookup; labels: Set<string> }>();
  for (const site of sites) {
    const group = byOntology.get(keyOf(site.ontology)) ?? {
      ontology: site.ontology,
      labels: new Set<string>(),
    };
    byOntology.set(keyOf(site.ontology), group);
    for (const item of site.holder[site.key as never] as unknown[]) {
      const label = labelOf(item);
      if (label) group.labels.add(label);
    }
  }
  const found = new Map<string, ReadonlyMap<string, Term>>();
  for (const [key, group] of byOntology) {
    found.set(
      key,
      resolve && group.labels.size ? await resolve(group.ontology, [...group.labels]) : new Map(),
    );
  }

  const unresolved = new Set<string>();
  for (const site of sites) {
    const terms = found.get(keyOf(site.ontology)) ?? new Map<string, Term>();
    const seen = new Set<string>();
    const items: (Term | { label: string })[] = [];
    for (const item of site.holder[site.key as never] as unknown[]) {
      const label = labelOf(item);
      if (!label) continue;
      const term = terms.get(label);
      const dedupe = term ? term.id : label.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      if (term) {
        items.push({ id: term.id, label: term.label });
      } else {
        items.push({ label });
        unresolved.add(label);
      }
    }
    (site.holder as Record<string | number, unknown>)[site.key] = items;
  }
  return { value: copy, unresolved: [...unresolved] };
}

/** A term search result, as `GET /x/ontologies/{name}/terms` returns it. */
export interface TermMatch {
  id: string;
  label: string;
  /** The synonym that matched, when it was not the label. */
  synonym?: string;
}

/** The match whose label or matched synonym is `label`, ignoring case; nothing looser counts. */
export function exactTerm(label: string, matches: readonly TermMatch[]): Term | undefined {
  const wanted = label.trim().toLowerCase();
  const hit = matches.find(
    (m) => m.label.toLowerCase() === wanted || m.synonym?.toLowerCase() === wanted,
  );
  return hit ? { id: hit.id, label: hit.label } : undefined;
}
