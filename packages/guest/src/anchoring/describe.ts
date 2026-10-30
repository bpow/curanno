/**
 * Describing: from a DOM range to the selectors a target stores. The quote
 * and position selectors are the text model's (`describeRange`, with its
 * 32 code points of context); the RangeSelector names the boundary text
 * nodes' parent elements by XPath relative to the scope root, each refined
 * by a collapsed TextPositionSelector in that element's own text.
 */
import {
  describeRange,
  extractText,
  textOffsetFromPoint,
  type RangeSelector,
  type Selector,
  type TextPoint,
  type TextRange,
  type XPathSelector,
} from '@scale/model';
import { domRangeOf, textRangeOf, type AnchoringScope } from './scope.js';
import { xpathFromNode } from './xpath.js';

/**
 * The selectors for a DOM range: `[TextQuoteSelector, TextPositionSelector,
 * RangeSelector]`, or undefined when the range covers no text of the scope.
 */
export function describe(scope: AnchoringScope, range: Range): Selector[] | undefined {
  const textRange = textRangeOf(scope, range);
  if (!textRange) return undefined;
  return describeTextRange(scope, textRange);
}

/** The selectors for a code point range of the scope's text. */
export function describeTextRange(scope: AnchoringScope, range: TextRange): Selector[] {
  const { quote, position } = describeRange(scope.map.text, range);
  const selectors: Selector[] = [quote, position];
  const rangeSelector = rangeSelectorOf(scope, range);
  if (rangeSelector) selectors.push(rangeSelector);
  return selectors;
}

function rangeSelectorOf(scope: AnchoringScope, range: TextRange): RangeSelector | undefined {
  const dom = domRangeOf(scope, range);
  if (!dom) return undefined;
  const start = xpathSelectorOf(
    scope,
    { node: dom.startContainer, offset: dom.startOffset },
    'start',
  );
  const end = xpathSelectorOf(scope, { node: dom.endContainer, offset: dom.endOffset }, 'end');
  if (!start || !end) return undefined;
  return { type: 'RangeSelector', startSelector: start, endSelector: end };
}

function xpathSelectorOf(
  scope: AnchoringScope,
  point: TextPoint<Node>,
  bias: 'start' | 'end',
): XPathSelector | undefined {
  const element = point.node.parentElement;
  if (!element || !scope.root.contains(element)) return undefined;
  const map = element === scope.root ? scope.map : extractText(element, scope.map.adapter);
  const offset = textOffsetFromPoint(map, point, bias);
  if (offset === undefined) return undefined;
  return {
    type: 'XPathSelector',
    value: xpathFromNode(element, scope.root),
    refinedBy: { type: 'TextPositionSelector', start: offset, end: offset },
  };
}
