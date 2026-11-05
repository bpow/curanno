/**
 * Browser entry point. Bundled by esbuild and injected into each corpus page
 * by the runner, which then calls `window.__trial`.
 */
import type { Expectation, Selection, Selector } from '../corpus.ts';
import { guest, guestSweep } from './candidates/guest.ts';
import { hypothesis } from './candidates/hypothesis.ts';
import type { AnchorResult, Candidate } from './candidates/types.ts';
import {
  describeRange,
  locate,
  nthIndexOf,
  rangeToSpan,
  rootText,
  spanToRange,
  type Span,
} from './text.ts';
import './highlights.ts';

/**
 * The guest candidates run by default. The Hypothesis candidate stays for
 * reference (`--all`): since the corpus selectors follow the project text
 * model it measures that code on selectors it does not implement.
 */
const defaultCandidates: Candidate[] = [guest, guestSweep];
const legacyCandidates: Candidate[] = [hypothesis];
const candidates = [...defaultCandidates, ...legacyCandidates];

function resolveRoot(selector?: string): HTMLElement {
  const el = selector ? document.querySelector<HTMLElement>(selector) : document.body;
  if (!el) throw new Error(`root not found: ${selector}`);
  return el;
}

export type DescribeResult = { selectors: Selector[]; span: Span; exact: string };

/** Selectors for a `select`, or null when the text lies in excluded content. */
function describe(rootSelector: string | undefined, select: Selection): DescribeResult | null {
  const root = resolveRoot(rootSelector);
  const scope = select.scope ? document.querySelector(select.scope) : root;
  if (!scope) throw new Error(`scope not found: ${select.scope}`);
  const scopeStart = scope === root ? 0 : rangeToSpan(root, scopeRange(scope)).start;
  const idx = nthIndexOf(scope.textContent ?? '', select.exact, select.occurrence ?? 1);
  if (idx === -1) throw new Error(`text not found: ${JSON.stringify(select)}`);
  const span = { start: scopeStart + idx, end: scopeStart + idx + select.exact.length };
  const range = spanToRange(root, span);
  const selectors = describeRange(root, range);
  return selectors ? { selectors, span, exact: range.toString() } : null;
}

function scopeRange(scope: Element): Range {
  const r = document.createRange();
  r.selectNodeContents(scope);
  return r;
}

function expectedSpan(rootSelector: string | undefined, expected: Expectation): Span | null {
  if ('mustNotMatch' in expected) return null;
  return locate(rootText(resolveRoot(rootSelector)), expected);
}

async function anchor(
  candidateId: string,
  rootSelector: string | undefined,
  items: { id: string; selectors: Selector[] }[],
): Promise<{ results: AnchorResult[]; ms: number }> {
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`unknown candidate ${candidateId}`);
  const root = resolveRoot(rootSelector);
  const t0 = performance.now();
  const results = await candidate.anchorAll(root, items);
  return { results, ms: performance.now() - t0 };
}

const api = {
  candidates: candidates.map((c) => ({
    id: c.id,
    description: c.description,
    sweep: c.sweep ?? false,
    legacy: legacyCandidates.includes(c),
  })),
  describe,
  expectedSpan,
  anchor,
  textLength: (rootSelector?: string) => rootText(resolveRoot(rootSelector)).length,
};

declare global {
  interface Window {
    __trial: typeof api;
  }
}

window.__trial = api;
