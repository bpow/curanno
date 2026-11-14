/**
 * Splitting a scope's view into pieces small enough for one request, cut
 * at a paragraph break where there is one in the second half of the piece,
 * else at a line break, a sentence end or a space. Consecutive chunks
 * overlap so that a passage cut in two is whole in one of them; the
 * pipeline drops the suggestions the overlap produces twice.
 */

/** A piece of a view's text, by UTF-16 index into the view. */
export interface Chunk {
  start: number;
  end: number;
  text: string;
}

export interface ChunkOptions {
  /** Longest chunk in UTF-16 code units. Default 6000, about 1500 tokens. */
  maxChars?: number;
  /** How far a chunk reaches back into the one before. Default 400. */
  overlapChars?: number;
}

export const DEFAULT_MAX_CHARS = 6000;
export const DEFAULT_OVERLAP_CHARS = 400;

const BOUNDARIES = [/\n\n/g, /\n/g, /[.!?]["')\]]?\s/g, /\s/g];

/** The index after the last boundary match in `text[from, to)`, preferring stronger boundaries. */
function cutPoint(text: string, from: number, to: number): number | undefined {
  const window = text.slice(from, to);
  for (const pattern of BOUNDARIES) {
    let best: number | undefined;
    for (const match of window.matchAll(pattern)) best = match.index + match[0].length;
    if (best !== undefined) return from + best;
  }
  return undefined;
}

/** The start of the next chunk: a boundary in the overlap window, else the cut itself. */
function restartPoint(text: string, cut: number, overlap: number, floor: number): number {
  if (overlap <= 0) return cut;
  const from = Math.max(floor + 1, cut - overlap);
  if (from >= cut) return cut;
  const window = text.slice(from, cut);
  for (const pattern of BOUNDARIES) {
    const match = pattern.exec(window);
    pattern.lastIndex = 0;
    if (match) return from + match.index + match[0].length;
  }
  return from;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const max = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  const overlap = Math.min(options.overlapChars ?? DEFAULT_OVERLAP_CHARS, Math.floor(max / 2));
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.length;
    if (end - start > max) {
      end = cutPoint(text, start + Math.floor(max / 2), start + max) ?? start + max;
      // Never between the halves of a surrogate pair.
      if (isLowSurrogate(text.charCodeAt(end))) end -= 1;
    }
    chunks.push({ start, end, text: text.slice(start, end) });
    if (end >= text.length) break;
    start = restartPoint(text, end, overlap, start);
  }
  return chunks;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
