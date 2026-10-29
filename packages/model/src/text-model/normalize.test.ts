import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { createDomAdapter, type DomLikeNode } from './dom-adapter.js';
import { extractText, inlineStyle, pointFromTextOffset } from './normalize.js';

function fragment(html: string): DomLikeNode {
  const div = new Window().document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('extractText', () => {
  it('honours a host-supplied computed style over markup', () => {
    const root = fragment('<p class="gone">hidden</p><p>shown</p>');
    const adapter = createDomAdapter({
      computedStyle: (el) =>
        (el as { className?: string }).className === 'gone'
          ? { display: 'none', whiteSpace: 'normal' }
          : null,
    });
    expect(extractText(root, adapter).text).toBe('shown');
  });

  it('maps offsets next to a <br> to the neighbouring text nodes', () => {
    const root = fragment('<p>ab<br>cd</p>');
    const map = extractText(root, createDomAdapter());
    expect(map.text).toBe('ab\ncd');
    const start = pointFromTextOffset(map, 2, 'start');
    const end = pointFromTextOffset(map, 3, 'end');
    expect(start?.node.data).toBe('ab');
    expect(start?.offset).toBe(2);
    expect(end?.node.data).toBe('cd');
    expect(end?.offset).toBe(0);
  });

  it('returns no point for an offset outside the text', () => {
    const map = extractText(fragment('<p>ab</p>'), createDomAdapter());
    expect(pointFromTextOffset(map, 3)).toBeUndefined();
  });

  it('treats the root itself like any element', () => {
    const root = fragment('<p>x</p>');
    (root as unknown as { setAttribute(n: string, v: string): void }).setAttribute('hidden', '');
    expect(extractText(root, createDomAdapter()).text).toBe('');
  });
});

describe('inlineStyle', () => {
  const adapter = createDomAdapter();
  it('reads the last declaration of a property, case-insensitively', () => {
    const el = fragment('<i style="Display: block; display : NONE !important">x</i>')
      .childNodes[0] as DomLikeNode;
    expect(inlineStyle(el, adapter, 'display')).toBe('none');
    expect(inlineStyle(el, adapter, 'white-space')).toBeNull();
  });
});
