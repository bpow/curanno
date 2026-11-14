/**
 * PDF targets (text model, section 11): a `FragmentSelector` naming a page,
 * refined by the text selectors scoped to that page's text. The guest
 * anchors them, and the sidebar builds them for suggestions on a PDF page.
 */
import type { Selector } from './types.js';

/** The `conformsTo` of a page fragment (RFC 3778, `page=N`). */
export const PDF_FRAGMENT_CONFORMS_TO = 'http://tools.ietf.org/rfc/rfc3778';

/** The page a fragment selector names, when it is a page fragment. */
export function pageOfFragment(value: string): number | undefined {
  const match = /^page=(\d+)(?:$|&)/.exec(value);
  const page = match ? Number(match[1]) : NaN;
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

export function pageFragmentSelector(page: number, refinedBy: Selector[]): Selector {
  return {
    type: 'FragmentSelector',
    conformsTo: PDF_FRAGMENT_CONFORMS_TO,
    value: `page=${page}`,
    refinedBy,
  };
}
