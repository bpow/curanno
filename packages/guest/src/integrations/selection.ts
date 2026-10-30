/**
 * Shared by the integrations: a DOM range becomes the selectors a target
 * stores, with collapsible whitespace and line feeds trimmed from both
 * ends so that a drag that overshoots a word does not quote the gap.
 */
import { textOfRange, type TextRange } from '@scale/model';
import { describeTextRange } from '../anchoring/describe.js';
import { textRangeOf, type AnchoringScope } from '../anchoring/scope.js';
import type { DescribedSelection } from './types.js';

const WHITESPACE = /^\s$/u;

/** Drop collapsible whitespace and line feeds from both ends of a selection. */
export function trimTextRange(text: string, range: TextRange): TextRange | undefined {
  const chars = [...textOfRange(text, range)];
  let start = 0;
  let end = chars.length;
  while (start < end && WHITESPACE.test(chars[start] as string)) start++;
  while (end > start && WHITESPACE.test(chars[end - 1] as string)) end--;
  if (start === end) return undefined;
  return { start: range.start + start, end: range.start + end };
}

export function describeSelection(
  scope: AnchoringScope,
  range: Range,
): DescribedSelection | undefined {
  const textRange = textRangeOf(scope, range);
  const trimmed = textRange && trimTextRange(scope.map.text, textRange);
  if (!trimmed) return undefined;
  return {
    selectors: describeTextRange(scope, trimmed),
    quote: textOfRange(scope.map.text, trimmed),
  };
}
