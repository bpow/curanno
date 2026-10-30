/**
 * Runs one text-model fixture through the guest's extraction, describe and
 * anchor in a real browser, with computed styles. Bundled into
 * `fixtures-runtime.js` by the harness; `fixtures.test.ts` compares what
 * comes back with the fixture's expectations.
 */
import { textOfRange, type TextPositionSelector, type TextQuoteSelector } from '@scale/model';
import { anchor } from '../../../src/anchoring/anchor.ts';
import { describe } from '../../../src/anchoring/describe.ts';
import { createScope, domRangeOf } from '../../../src/anchoring/scope.ts';

export interface FixtureRangeResult {
  described: { quote: TextQuoteSelector; position: TextPositionSelector } | null;
  /** Round trip: anchoring the described selectors, by each selector alone and together. */
  reanchored: string[];
  /** Anchoring the fixture's own expected selectors, when any. */
  anchoredExpected: { start: number; end: number } | null;
}

export interface FixtureResult {
  text: string;
  ranges: Record<string, FixtureRangeResult>;
}

const MARKER = /⟦(\/?)([A-Za-z0-9_-]+)⟧/g;

type Marks = Map<
  string,
  { start?: { node: Text; offset: number }; end?: { node: Text; offset: number } }
>;

/** Strip range markers from text nodes under `scope`, recording where they stood. */
function stripMarkers(scope: Element): Marks {
  const marks: Marks = new Map();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) {
    let stripped = '';
    let last = 0;
    for (const m of node.data.matchAll(MARKER)) {
      stripped += node.data.slice(last, m.index);
      const entry = marks.get(m[2] as string) ?? {};
      entry[m[1] ? 'end' : 'start'] = { node, offset: stripped.length };
      marks.set(m[2] as string, entry);
      last = m.index + m[0].length;
    }
    stripped += node.data.slice(last);
    if (stripped !== node.data) node.data = stripped;
  }
  return marks;
}

function run(
  scopeSelector: string,
  expected: Record<string, { quote: TextQuoteSelector; position: TextPositionSelector } | null>,
): FixtureResult {
  const scopeElement = document.querySelector(scopeSelector);
  if (!scopeElement) throw new Error(`no scope ${scopeSelector}`);
  const marks = stripMarkers(scopeElement);
  const scope = createScope(scopeElement);
  const ranges: Record<string, FixtureRangeResult> = {};
  for (const [name, expectation] of Object.entries(expected)) {
    const mark = marks.get(name);
    if (!mark?.start || !mark.end) throw new Error(`fixture lacks both markers for ${name}`);
    const range = document.createRange();
    range.setStart(mark.start.node, mark.start.offset);
    range.setEnd(mark.end.node, mark.end.offset);
    const selectors = describe(scope, range);
    const quote = selectors?.find((s) => s.type === 'TextQuoteSelector');
    const position = selectors?.find((s) => s.type === 'TextPositionSelector');
    const reanchored: string[] = [];
    if (selectors) {
      for (const subset of [...selectors.map((s) => [s]), selectors]) {
        const result = anchor(scope, subset);
        if (result.state !== 'anchored') {
          reanchored.push(result.state);
          continue;
        }
        // The normalized text of the range, and proof it maps to a live DOM range.
        const dom = domRangeOf(scope, result.range);
        reanchored.push(dom ? textOfRange(scope.map.text, result.range) : '<no dom range>');
      }
    }
    let anchoredExpected: { start: number; end: number } | null = null;
    if (expectation) {
      const result = anchor(scope, [expectation.quote, expectation.position]);
      if (result.state === 'anchored') anchoredExpected = result.range;
    }
    ranges[name] = {
      described: quote && position ? { quote: quote, position: position } : null,
      reanchored,
      anchoredExpected,
    };
  }
  return { text: scope.map.text, ranges };
}

declare global {
  interface Window {
    __fixtures: { run: typeof run };
  }
}

window.__fixtures = { run };
