import type { Selector } from '../../corpus.ts';
import type { Span } from '../text.ts';

export type AnchorResult = {
  span: Span | null;
  /** How the range was found: 'position', 'quote', or unspecified. */
  via?: string;
  /** Quote-match score in [0, 1] when `via` is 'quote'; 1 for a position hit. */
  score?: number;
  error?: string;
};

export type Candidate = {
  id: string;
  description: string;
  /** Include this candidate's recorded scores in the report's threshold sweep. */
  sweep?: boolean;
  /** Anchor each annotation's selectors against `root`. Results keep the input order. */
  anchorAll(
    root: HTMLElement,
    items: { id: string; selectors: Selector[] }[],
  ): AnchorResult[] | Promise<AnchorResult[]>;
};
