import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { blockStarts } from './blocks.js';
import { createDomAdapter, type DomLikeNode } from './dom-adapter.js';
import { extractText } from './normalize.js';

function starts(html: string, computed?: Record<string, string>) {
  const window = new Window();
  const div = window.document.createElement('div');
  div.innerHTML = html;
  const root = div as unknown as DomLikeNode;
  const adapter = createDomAdapter(
    computed
      ? {
          computedStyle: (el) => {
            const tag = el.nodeName.toLowerCase();
            return { display: computed[tag] ?? 'inline', whiteSpace: 'normal' };
          },
        }
      : {},
  );
  const map = extractText(root, adapter);
  return { text: map.text, starts: blockStarts(root, map) };
}

describe('blockStarts', () => {
  it('marks where each paragraph begins', () => {
    expect(starts('<p>one</p><p>two</p><p>three</p>')).toEqual({
      text: 'onetwothree',
      starts: [3, 6],
    });
  });

  it('ignores inline elements and the whitespace between blocks', () => {
    expect(starts('<div><p>a <em>b</em></p> <p>c</p></div>')).toEqual({
      text: 'a b c',
      starts: [4],
    });
  });

  it('counts text after a nested block as a new block', () => {
    expect(starts('<div>head<p>para</p>tail</div>').starts).toEqual([4, 8]);
  });

  it('uses computed display when the adapter has it', () => {
    expect(starts('<span>one</span><span>two</span>', { span: 'block' }).starts).toEqual([3]);
    expect(starts('<p>one</p><p>two</p>', { p: 'inline' }).starts).toEqual([]);
  });
});
