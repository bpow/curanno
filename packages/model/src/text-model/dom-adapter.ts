import type { TextTreeAdapter } from './adapter.js';

/**
 * Adapter over any DOM-shaped tree: a browser document, or a DOM library in
 * tests. Typed structurally so this package needs no DOM type library.
 *
 * Without `computedStyle` the adapter knows only what the markup says
 * (inline `style`, `hidden`, `aria-hidden`, element names). A guest running
 * in a browser must pass `computedStyle: (el) => getComputedStyle(el)` so
 * that stylesheet-driven `display: none` and `white-space` are honoured, as
 * the specification requires.
 */
export interface DomLikeNode {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomLikeNode> & Iterable<DomLikeNode>;
  data?: string;
  getAttribute?(name: string): string | null;
}

export interface DomAdapterOptions<N extends DomLikeNode> {
  computedStyle?: (element: N) => { display: string; whiteSpace: string } | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

export function createDomAdapter<N extends DomLikeNode = DomLikeNode>(
  options: DomAdapterOptions<N> = {},
): TextTreeAdapter<N> {
  const styled = options.computedStyle;
  const adapter: TextTreeAdapter<N> = {
    kind(node) {
      if (node.nodeType === ELEMENT_NODE) return 'element';
      if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) return 'text';
      return 'other';
    },
    tagName(node) {
      return node.nodeName.toLowerCase();
    },
    attribute(node, name) {
      return node.getAttribute?.(name) ?? null;
    },
    children(node) {
      return node.childNodes as Iterable<N>;
    },
    textData(node) {
      return node.data ?? '';
    },
  };
  if (styled) {
    adapter.display = (node) => styled(node)?.display ?? null;
    adapter.whiteSpace = (node) => styled(node)?.whiteSpace ?? null;
  }
  return adapter;
}
