/**
 * Where blocks start in a scope's normalized text. The text model adds no
 * separator between blocks (section 6, ADR 0013), so `<p>one</p><p>two</p>`
 * is `onetwo`. A reader of the text, such as a language model, still needs
 * paragraphs, so this reports the offsets at which a new block begins. It is
 * a hint for presentation only: offsets and selectors never depend on it.
 */
import type { TextTreeAdapter } from './adapter.js';
import type { TextMap } from './normalize.js';

/** Elements treated as blocks when the adapter does not know computed `display`. */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

function isBlock<N>(adapter: TextTreeAdapter<N>, node: N): boolean {
  const display = adapter.display?.(node);
  if (display !== undefined && display !== null) return !/^(inline|contents|none)/.test(display);
  return BLOCK_ELEMENTS.has(adapter.tagName(node));
}

/**
 * Code point offsets in `map.text` where text from a different block than
 * the text before it begins, ascending and without 0.
 */
export function blockStarts<N>(root: N, map: TextMap<N>): number[] {
  const { adapter } = map;
  const blockOf = new Map<N, N>();
  const visit = (node: N, block: N): void => {
    const kind = adapter.kind(node);
    if (kind === 'text') {
      blockOf.set(node, block);
    } else if (kind === 'element') {
      const inner = isBlock(adapter, node) ? node : block;
      for (const child of adapter.children(node)) visit(child, inner);
    }
  };
  visit(root, root);
  const starts: number[] = [];
  let previous: N | undefined;
  for (const segment of map.segments) {
    if (segment.kind !== 'text' && segment.kind !== 'nfc') continue;
    const block = blockOf.get(segment.node);
    if (block === undefined) continue;
    if (previous !== undefined && block !== previous && segment.textStart > 0) {
      if (starts[starts.length - 1] !== segment.textStart) starts.push(segment.textStart);
    }
    previous = block;
  }
  return starts;
}
