// @vitest-environment happy-dom
import type { Selector, TextQuoteSelector } from '@scale/model';
import { beforeEach, describe as suite, expect, it } from 'vitest';
import { anchor, MIN_FUZZY_QUOTE_LENGTH } from './anchor.js';
import { describe } from './describe.js';
import { createScope, domRangeOf, textRangeOf } from './scope.js';
import { nodeFromXPath, xpathFromNode } from './xpath.js';

const PAGE = `
  <main>
    <h1>Release notes</h1>
    <p>Version 3.2 is a <em>maintenance</em>   release.
       It fixes the <span hidden>(ticket 4411)</span> crash on startup.</p>
    <p>Line one<br>line two 😀 done.</p>
    <p>Repeated phrase here. Repeated phrase here.</p>
  </main>`;

function selectText(text: string, occurrence = 1): Range {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    const at = data.indexOf(text);
    if (at < 0) continue;
    if (++seen < occurrence) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    return range;
  }
  throw new Error(`not found: ${text}`);
}

function quoteOf(selectors: Selector[]): TextQuoteSelector {
  return selectors.find((s) => s.type === 'TextQuoteSelector') as TextQuoteSelector;
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

suite('describe', () => {
  it('produces quote, position and range selectors in the text model', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('maintenance'));
    expect(selectors).toEqual([
      {
        type: 'TextQuoteSelector',
        exact: 'maintenance',
        prefix: 'Release notes Version 3.2 is a ',
        suffix: ' release. It fixes the crash on ',
      },
      { type: 'TextPositionSelector', start: 31, end: 42 },
      {
        type: 'RangeSelector',
        startSelector: {
          type: 'XPathSelector',
          value: '/main[1]/p[1]/em[1]',
          refinedBy: { type: 'TextPositionSelector', start: 0, end: 0 },
        },
        endSelector: {
          type: 'XPathSelector',
          value: '/main[1]/p[1]/em[1]',
          refinedBy: { type: 'TextPositionSelector', start: 11, end: 11 },
        },
      },
    ]);
  });

  it('counts code points and keeps br as a line feed', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('done'));
    const position = selectors?.find((s) => s.type === 'TextPositionSelector');
    const text = scope.map.text;
    expect(text).toContain('Line one\nline two 😀 done.');
    expect(position).toEqual({
      type: 'TextPositionSelector',
      start: [...text].indexOf('d', [...text].indexOf('😀')),
      end: [...text].indexOf('d', [...text].indexOf('😀')) + 4,
    });
  });

  it('moves element boundary points to the enclosed text', () => {
    const scope = createScope(document.body);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('h1') as Element);
    expect(quoteOf(describe(scope, range) ?? []).exact).toBe('Release notes');
    const main = document.querySelector('main') as Element;
    range.setStart(main, 0);
    range.setEnd(main, 2);
    expect(textRangeOf(scope, range)).toEqual({ start: 0, end: 13 });
  });

  it('returns undefined for a range inside hidden content', () => {
    const scope = createScope(document.body);
    expect(describe(scope, selectText('ticket'))).toBeUndefined();
  });
});

suite('anchor', () => {
  it('round-trips through each selector type alone', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('crash on startup')) as Selector[];
    for (const selector of selectors) {
      const result = anchor(scope, selector);
      expect(result.state).toBe('anchored');
      if (result.state === 'anchored') {
        expect(domRangeOf(scope, result.range)?.toString()).toBe('crash on startup');
      }
    }
  });

  it('prefers the range, then the position, each checked against the quote', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('maintenance')) as Selector[];
    expect(anchor(scope, selectors)).toMatchObject({ via: 'range' });

    // Insert a paragraph before: the XPath now names a different element.
    const extra = document.createElement('p');
    extra.textContent = 'An inserted paragraph of exactly forty chars.';
    document.querySelector('main')?.prepend(extra);
    expect(anchor(createScope(document.body), selectors)).toMatchObject({ via: 'quote' });
  });

  it('falls back to approximate matching above the score threshold', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('crash on startup')) as Selector[];
    const p = document.querySelectorAll('p')[0] as HTMLParagraphElement;
    p.innerHTML = p.innerHTML.replace('crash on startup', 'crash at startup');
    const result = anchor(createScope(document.body), selectors);
    expect(result).toMatchObject({ state: 'anchored', via: 'quote' });
    if (result.state === 'anchored') {
      expect(result.score).toBeLessThan(1);
      expect(domRangeOf(createScope(document.body), result.range)?.toString()).toBe(
        'crash at startup',
      );
    }
  });

  it('reports an orphan when the quote is gone, and never rewrites selectors', () => {
    const scope = createScope(document.body);
    const selectors = describe(scope, selectText('crash on startup')) as Selector[];
    const before = JSON.stringify(selectors);
    const p = document.querySelectorAll('p')[0] as HTMLParagraphElement;
    p.innerHTML = 'Version 3.2 is a maintenance release.';
    expect(anchor(createScope(document.body), selectors).state).toBe('orphaned');
    expect(JSON.stringify(selectors)).toBe(before);
  });

  it('does not match short quotes approximately', () => {
    const quote: TextQuoteSelector = { type: 'TextQuoteSelector', exact: 'Version 3.3' };
    expect(quote.exact.length).toBeGreaterThanOrEqual(MIN_FUZZY_QUOTE_LENGTH);
    const scope = createScope(document.body);
    expect(anchor(scope, quote)).toMatchObject({ state: 'anchored', via: 'quote' });
    const short: TextQuoteSelector = { type: 'TextQuoteSelector', exact: '3.3' };
    expect(anchor(scope, short).state).toBe('orphaned');
  });

  it('reports ambiguity when two occurrences match equally well', () => {
    const scope = createScope(document.body);
    const result = anchor(scope, { type: 'TextQuoteSelector', exact: 'Repeated phrase' });
    expect(result.state).toBe('ambiguous');
    if (result.state === 'ambiguous') expect(result.candidates).toHaveLength(2);
    const withContext = anchor(scope, {
      type: 'TextQuoteSelector',
      exact: 'Repeated phrase',
      prefix: 'here. ',
    });
    expect(withContext).toMatchObject({ state: 'anchored', via: 'quote' });
  });

  it('ignores targets without text selectors', () => {
    const scope = createScope(document.body);
    expect(anchor(scope, { type: 'CssSelector', value: 'h1' })).toMatchObject({
      state: 'orphaned',
    });
  });
});

suite('xpath', () => {
  it('round-trips simple paths and names the root as /', () => {
    const em = document.querySelector('em') as Element;
    expect(xpathFromNode(em, document.body)).toBe('/main[1]/p[1]/em[1]');
    expect(nodeFromXPath('/main[1]/p[1]/em[1]', document.body)).toBe(em);
    expect(nodeFromXPath('/', document.body)).toBe(document.body);
    expect(nodeFromXPath('/main[1]/p[9]', document.body)).toBeNull();
  });
});
