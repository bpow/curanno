import type { Selector } from '../corpus.ts';

/** The text selectors inside any page fragment, for candidates that know nothing of pages. */
export function flattenSelectors(selectors: Selector[]): Selector[] {
  return selectors.flatMap((s) =>
    s.type === 'FragmentSelector' ? flattenSelectors(s.refinedBy) : [s],
  );
}
