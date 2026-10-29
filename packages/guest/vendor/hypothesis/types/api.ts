/**
 * Excerpt of `src/types/api.ts` from the Hypothesis client, reduced to the
 * selector types used by the copied anchoring modules. See ../PROVENANCE.md.
 */

/**
 * Selector which indicates the time range within a video or audio file that
 * an annotation refers to.
 */
export type MediaTimeSelector = {
  type: 'MediaTimeSelector';

  /** Offset from start of media in seconds. */
  start: number;
  /** Offset from start of media in seconds. */
  end: number;
};

/**
 * Selector which identifies a document region using the selected text plus
 * the surrounding context.
 */
export type TextQuoteSelector = {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
};

/**
 * Selector which identifies a document region using UTF-16 character offsets
 * in the document body's `textContent`.
 */
export type TextPositionSelector = {
  type: 'TextPositionSelector';
  start: number;
  end: number;
};

/**
 * Selector which identifies a document region using XPaths and character offsets.
 */
export type RangeSelector = {
  type: 'RangeSelector';
  startContainer: string;
  endContainer: string;
  startOffset: number;
  endOffset: number;
};

export type Selector =
  | TextQuoteSelector
  | TextPositionSelector
  | RangeSelector
  | MediaTimeSelector;
