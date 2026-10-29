/**
 * Types for `corpus/cases/<id>/case.json` and loaders for them. The format
 * is described in `corpus/README.md`; this file is the executable version.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type TextQuoteSelector = {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type TextPositionSelector = {
  type: 'TextPositionSelector';
  start: number;
  end: number;
};

export type XPathSelector = {
  type: 'XPathSelector';
  value: string;
  refinedBy?: TextPositionSelector;
};

export type RangeSelector = {
  type: 'RangeSelector';
  startSelector: XPathSelector;
  endSelector: XPathSelector;
};

export type Selector = TextQuoteSelector | TextPositionSelector | RangeSelector;

/** Authoring input: which text of the original variant the annotation covers. */
export type Selection = {
  exact: string;
  /** 1-based occurrence of `exact` within the scope. Default 1. */
  occurrence?: number;
  /** CSS selector narrowing where occurrences are counted. Default: the root. */
  scope?: string;
};

export type Expectation =
  | {
      exact: string;
      /** Text immediately before the expected match, to pick among duplicates. */
      prefix?: string;
      suffix?: string;
      note?: string;
    }
  | { mustNotMatch: true; reason: string };

export type Annotation = {
  id: string;
  description: string;
  /** Groups the parts of a discontiguous selection. */
  partOf?: string;
  select: Selection;
  selectors?: Selector[];
  /** Keyed by variant id. A missing key means `select.exact` is expected. */
  expected?: Record<string, Expectation>;
};

export type Variant = {
  id: string;
  file: string;
  query?: string;
  description: string;
};

export type Case = {
  id: string;
  title: string;
  kind: 'html' | 'pdf';
  source: { url?: string; license: string; note?: string };
  tags: string[];
  /** CSS selector of the anchoring root. Default `body`, or the text layer for PDFs. */
  root?: string;
  variants: Variant[];
  annotations: Annotation[];
};

export const CORPUS_DIR = path.resolve(import.meta.dirname, '../../corpus');
export const CASES_DIR = path.join(CORPUS_DIR, 'cases');

export async function loadCases(filter?: string[]): Promise<Case[]> {
  const ids = (await readdir(CASES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const cases: Case[] = [];
  for (const id of ids) {
    if (filter && filter.length > 0 && !filter.includes(id)) continue;
    const c = JSON.parse(await readFile(path.join(CASES_DIR, id, 'case.json'), 'utf8')) as Case;
    if (c.id !== id) throw new Error(`case.json in ${id} has id ${c.id}`);
    if (!c.variants.some((v) => v.id === 'original')) {
      throw new Error(`case ${id} has no 'original' variant`);
    }
    cases.push(c);
  }
  return cases;
}

export function expectationFor(annotation: Annotation, variantId: string): Expectation {
  return annotation.expected?.[variantId] ?? { exact: annotation.select.exact };
}

export function variantUrl(c: Case, v: Variant, origin: string): string {
  const file = `/cases/${c.id}/${v.file}`;
  if (c.kind === 'pdf') {
    return `${origin}/__trial/pdf-view.html?file=${encodeURIComponent(file)}`;
  }
  return `${origin}${file}${v.query ? `?${v.query}` : ''}`;
}
