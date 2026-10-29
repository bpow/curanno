import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import type { TextPositionSelector, TextQuoteSelector } from '../annotation/types.js';
import type { TextPoint } from './adapter.js';
import { createDomAdapter, type DomLikeNode } from './dom-adapter.js';
import { extractText, pointFromTextOffset, textOffsetFromPoint } from './normalize.js';
import { describeRange, findQuote, rangeFromPoints, resolvePosition } from './selectors.js';

interface Fixture {
  name: string;
  description?: string;
  html: string;
  text: string;
  ranges?: Record<string, { quote: TextQuoteSelector; position: TextPositionSelector } | null>;
}

const MARKER = /⟦(\/?)([A-Za-z0-9_-]+)⟧/g;
const dir = fileURLToPath(new URL('../../fixtures/text-model/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as Fixture);

type Marks = Map<string, { start?: TextPoint<DomLikeNode>; end?: TextPoint<DomLikeNode> }>;

/** Parse the fixture HTML, strip range markers and record where they stood. */
function load(html: string): { scope: DomLikeNode; marks: Marks } {
  const window = new Window();
  const document = window.document;
  let scope: DomLikeNode;
  if (/^\s*(<!doctype|<html)/i.test(html)) {
    const parsed = new window.DOMParser().parseFromString(html, 'text/html');
    scope = parsed.body;
  } else {
    const div = document.createElement('div');
    div.innerHTML = html;
    scope = div;
  }
  const marks: Marks = new Map();
  const visit = (node: DomLikeNode): void => {
    if (node.nodeType === 3) {
      const text = node as DomLikeNode & { data: string };
      let stripped = '';
      let last = 0;
      for (const m of text.data.matchAll(MARKER)) {
        stripped += text.data.slice(last, m.index);
        const entry = marks.get(m[2] as string) ?? {};
        entry[m[1] ? 'end' : 'start'] = { node: text, offset: stripped.length };
        marks.set(m[2] as string, entry);
        last = m.index + m[0].length;
      }
      stripped += text.data.slice(last);
      text.data = stripped;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(scope);
  return { scope, marks };
}

const adapter = createDomAdapter();

describe('text model fixtures', () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      const { scope, marks } = load(fixture.html);
      const map = extractText(scope, adapter);

      it('normalizes the text', () => {
        expect(map.text).toBe(fixture.text);
      });

      for (const [name, expected] of Object.entries(fixture.ranges ?? {})) {
        it(`describes range ${name}`, () => {
          const mark = marks.get(name);
          if (!mark?.start || !mark.end) throw new Error(`fixture lacks both markers for ${name}`);
          const range = rangeFromPoints(map, mark.start, mark.end);
          if (expected === null) {
            expect(range).toBeUndefined();
            return;
          }
          expect(range).toBeDefined();
          const selectors = describeRange(map.text, range as NonNullable<typeof range>);
          expect(selectors.quote).toEqual(expected.quote);
          expect(selectors.position).toEqual(expected.position);
          expect(resolvePosition(map.text, expected.position)).toBe(expected.quote.exact);

          const best = findQuote(map, expected.quote, expected.position.start)[0];
          expect(best).toMatchObject({
            start: expected.position.start,
            end: expected.position.end,
            exactContext: true,
          });

          // Offsets map back to points and forward to the same offsets.
          const start = pointFromTextOffset(map, expected.position.start, 'start');
          const end = pointFromTextOffset(map, expected.position.end, 'end');
          expect(start && textOffsetFromPoint(map, start, 'start')).toBe(expected.position.start);
          expect(end && textOffsetFromPoint(map, end, 'end')).toBe(expected.position.end);
        });
      }
    });
  }
});
