/**
 * The bridge between DOM ranges and the text model: a scope is a root
 * element with its extracted text map (docs/text-model.md, section 9).
 * Offsets on this side of the bridge are code points; DOM boundary points
 * are text nodes with UTF-16 offsets, converted only through the map.
 */
import {
  createDomAdapter,
  extractText,
  pointFromTextOffset,
  rangeFromPoints,
  type TextMap,
  type TextPoint,
  type TextRange,
  type TextTreeAdapter,
} from '@scale/model';

export interface AnchoringScope {
  root: Element;
  map: TextMap<Node>;
}

/**
 * The text model adapter for a live browser DOM: computed `display` and
 * `white-space` come from the element's window, as the specification
 * requires of implementations that have them.
 */
export function createBrowserAdapter(): TextTreeAdapter<Node> {
  return createDomAdapter<Node>({
    computedStyle(node) {
      const view = node.ownerDocument?.defaultView;
      if (!view || typeof view.getComputedStyle !== 'function') return null;
      const style = view.getComputedStyle(node as Element);
      return { display: style.display, whiteSpace: style.whiteSpace };
    },
  });
}

/** Extract the text of `root` and build its map. Re-run after the DOM changes. */
export function createScope(root: Element, adapter = createBrowserAdapter()): AnchoringScope {
  return { root, map: extractText(root, adapter) };
}

/** A DOM Range over the text a code point range covers, or undefined when it has none. */
export function domRangeOf(scope: AnchoringScope, range: TextRange): Range | undefined {
  const start = pointFromTextOffset(scope.map, range.start, 'start');
  const end = pointFromTextOffset(scope.map, range.end, 'end');
  if (!start || !end) return undefined;
  const dom = scope.root.ownerDocument.createRange();
  dom.setStart(start.node, start.offset);
  dom.setEnd(end.node, end.offset);
  return dom;
}

/** The text nodes that contribute to the scope's text, in document order. */
function contributingNodes(scope: AnchoringScope): Node[] {
  return Array.from(scope.map.byNode.keys());
}

/**
 * A DOM range's boundary points as text points. A point inside a text node
 * is used as is; a point between nodes moves to the nearest contributing
 * text node inside the range (forwards for the start, backwards for the end).
 */
export function textPointsOf(
  scope: AnchoringScope,
  range: Range,
): { start: TextPoint<Node>; end: TextPoint<Node> } | undefined {
  const nodes = contributingNodes(scope);
  const probe = scope.root.ownerDocument.createRange();
  const start = pointAt(range.startContainer, range.startOffset, 'start');
  const end = pointAt(range.endContainer, range.endOffset, 'end');
  return start && end ? { start, end } : undefined;

  function pointAt(container: Node, offset: number, side: 'start' | 'end') {
    if (container.nodeType === Node.TEXT_NODE || container.nodeType === Node.CDATA_SECTION_NODE) {
      return { node: container, offset };
    }
    probe.setStart(container, offset);
    probe.collapse(true);
    if (side === 'start') {
      for (const node of nodes) {
        if (probe.comparePoint(node, 0) >= 0) return { node, offset: 0 };
      }
    } else {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i] as Node;
        const length = (node as CharacterData).data.length;
        if (probe.comparePoint(node, length) <= 0) return { node, offset: length };
      }
    }
    return undefined;
  }
}

/** The code point range a DOM range covers, or undefined when it covers no text. */
export function textRangeOf(scope: AnchoringScope, range: Range): TextRange | undefined {
  const points = textPointsOf(scope, range);
  if (!points) return undefined;
  return rangeFromPoints(scope.map, points.start, points.end);
}
