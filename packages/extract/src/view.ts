/**
 * What the model reads: a scope's normalized text with a blank line where
 * each block begins (`blockStarts` in the model package), since the text
 * model joins blocks with no separator. Offsets found in the view map back
 * to the normalized text, so a quote the model copies across a paragraph
 * break still resolves to the text that selectors count.
 *
 * Offsets here are UTF-16 indices; conversion to code points happens once
 * a match is final.
 */
import { codePointToUtf16 } from '@curanno/model';

export const BLOCK_SEPARATOR = '\n\n';

export interface ScopeView {
  /** The normalized text. */
  source: string;
  /** The text with separators inserted. */
  text: string;
  /** Source indices before which a separator was inserted, ascending. */
  breaks: number[];
}

/** Build the view of `source` with a separator before each block start (code point offsets). */
export function buildView(source: string, blockStarts: readonly number[] = []): ScopeView {
  const breaks = [...new Set(blockStarts.map((b) => codePointToUtf16(source, b)))]
    .filter((i) => i > 0 && i < source.length)
    .sort((a, b) => a - b);
  let text = '';
  let last = 0;
  for (const i of breaks) {
    text += source.slice(last, i) + BLOCK_SEPARATOR;
    last = i;
  }
  return { source, text: text + source.slice(last), breaks };
}

/**
 * The source index for a view index. An index inside a separator maps to
 * the block start the separator stands for.
 */
export function toSource(view: ScopeView, index: number): number {
  let shift = 0;
  for (const at of view.breaks) {
    const viewAt = at + shift;
    if (index < viewAt) break;
    if (index < viewAt + BLOCK_SEPARATOR.length) return at;
    shift += BLOCK_SEPARATOR.length;
  }
  return index - shift;
}
