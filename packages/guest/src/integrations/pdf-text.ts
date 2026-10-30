/**
 * The text of a PDF page as the PDF.js text layer would render it, built
 * from `getTextContent()` items without a DOM (text model, section 11): one
 * text node per item, a `br` where an item ends a line, and a nested span
 * per marked-content sequence, hidden from the text model when PDF.js
 * would mark it `aria-hidden` (artifacts such as running headers). Letting
 * the text model walk this tree gives the same normalized text and offsets
 * as the rendered layer, so pages that are not rendered yet can be anchored.
 */
import { createDomAdapter, extractText, type DomLikeNode } from '@curanno/model';
import type { AnchoringScope } from '../anchoring/scope.js';

/** The parts of a PDF.js text content item the layout mirrors. */
export interface PdfTextItem {
  /** Absent on marked-content items. */
  str?: string;
  hasEOL?: boolean;
  type?: string;
  tag?: string;
}

export interface VirtualNode extends DomLikeNode {
  nodeType: 1 | 3;
  nodeName: string;
  childNodes: VirtualNode[];
  parentNode: VirtualNode | null;
  data?: string;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
}

function element(name: string, attributes: Record<string, string> = {}): VirtualNode {
  const node: VirtualNode = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: [],
    parentNode: null,
    attributes,
    getAttribute: (key) => node.attributes[key] ?? null,
  };
  return node;
}

function text(data: string): VirtualNode {
  const node: VirtualNode = {
    nodeType: 3,
    nodeName: '#text',
    childNodes: [],
    parentNode: null,
    data,
    attributes: {},
    getAttribute: () => null,
  };
  return node;
}

function append(parent: VirtualNode, child: VirtualNode): void {
  child.parentNode = parent;
  parent.childNodes.push(child);
}

/** The tree PDF.js's `TextLayer` would build from these items. */
export function pageTextTree(items: Iterable<PdfTextItem>): VirtualNode {
  const root = element('div', { class: 'textLayer' });
  let container = root;
  for (const item of items) {
    if (item.str === undefined) {
      if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') {
        const span = element(
          'span',
          item.tag === 'Artifact'
            ? { class: 'markedContent', 'aria-hidden': 'true' }
            : { class: 'markedContent' },
        );
        append(container, span);
        container = span;
      } else if (item.type === 'endMarkedContent') {
        container = container.parentNode ?? root;
      }
      continue;
    }
    if (item.str !== '') append(container, text(item.str));
    if (item.hasEOL) append(container, element('br'));
  }
  return root;
}

/** An anchoring scope over the virtual tree of a page. */
export function pageTextScope(items: Iterable<PdfTextItem>): AnchoringScope<VirtualNode> {
  const root = pageTextTree(items);
  return { root, map: extractText(root, createDomAdapter<VirtualNode>()) };
}
