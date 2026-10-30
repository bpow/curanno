/**
 * Simple XPaths of the form `/tag[n]/tag[n]` relative to a root element, as
 * `RangeSelector` stores them. Derived from the Hypothesis client's
 * `src/annotator/anchoring/xpath.ts` (BSD-2-Clause; see
 * ../../vendor/hypothesis/LICENSE and PROVENANCE.md). Changes: strict typing,
 * the path `/` names the root itself, and the `document.evaluate` fallback
 * for other XPath forms is skipped where the DOM lacks it.
 */

function pathSegment(node: Node): string {
  let position = 0;
  for (let sibling: Node | null = node; sibling; sibling = sibling.previousSibling) {
    if (sibling.nodeName === node.nodeName) position++;
  }
  const name = node.nodeName.toLowerCase();
  return `${name === '#text' ? 'text()' : name}[${position}]`;
}

/** The path of `node` relative to `root`, or `/` for the root itself. */
export function xpathFromNode(node: Node, root: Node): string {
  const segments: string[] = [];
  for (let current: Node | null = node; current !== root; current = current.parentNode) {
    if (!current) throw new Error('Node is not a descendant of root');
    segments.unshift(pathSegment(current));
  }
  return '/' + segments.join('/');
}

function nthChildOfType(element: Element, name: string, index: number): Element | null {
  const upper = name.toUpperCase();
  let seen = -1;
  for (const child of Array.from(element.children)) {
    if (child.nodeName.toUpperCase() !== upper) continue;
    if (++seen === index) return child;
  }
  return null;
}

const SIMPLE_XPATH = /^(\/[A-Za-z0-9-]+(\[[0-9]+\])?)+$/;

function evaluateSimpleXPath(xpath: string, root: Element): Element | null {
  let element: Element = root;
  for (const segment of xpath.split('/').slice(1)) {
    const bracket = segment.indexOf('[');
    const name = bracket < 0 ? segment : segment.slice(0, bracket);
    const index = bracket < 0 ? 0 : parseInt(segment.slice(bracket + 1, -1), 10) - 1;
    if (index < 0) return null;
    const child = nthChildOfType(element, name, index);
    if (!child) return null;
    element = child;
  }
  return element;
}

/**
 * The element a `RangeSelector` XPath names, relative to `root`. Simple
 * paths are matched by name and index without regard to namespaces or
 * document type; anything else goes to `document.evaluate` when available.
 */
export function nodeFromXPath(xpath: string, root: Element): Node | null {
  if (xpath === '' || xpath === '/') return root;
  if (SIMPLE_XPATH.test(xpath)) return evaluateSimpleXPath(xpath, root);
  const doc = root.ownerDocument;
  if (typeof doc.evaluate !== 'function') return null;
  try {
    return doc.evaluate('.' + xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue;
  } catch {
    return null;
  }
}
