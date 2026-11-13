import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.js';

describe('chunkText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkText('short', { maxChars: 100 })).toEqual([{ start: 0, end: 5, text: 'short' }]);
  });

  it('cuts at paragraph breaks and covers the whole text', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${'x'.repeat(30)}.`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, { maxChars: 120, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(120);
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
    }
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text.endsWith('\n\n')).toBe(true);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(text.length);
    chunks.slice(1).forEach((c, i) => expect(c.start).toBe(chunks[i]?.end));
  });

  it('overlaps consecutive chunks, restarting at a boundary', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkText(text, { maxChars: 200, overlapChars: 60 });
    chunks.slice(1).forEach((c, i) => {
      const previous = chunks[i]!;
      expect(c.start).toBeLessThan(previous.end);
      expect(c.start).toBeGreaterThan(previous.start);
      expect(text.slice(c.start)).toMatch(/^Sentence/);
    });
    expect(chunks.at(-1)?.end).toBe(text.length);
  });

  it('cuts text without any boundary at the limit', () => {
    const chunks = chunkText('y'.repeat(250), { maxChars: 100, overlapChars: 0 });
    expect(chunks.map((c) => c.text.length)).toEqual([100, 100, 50]);
  });

  it('never splits a surrogate pair', () => {
    const text = '😀'.repeat(60);
    const chunks = chunkText(text, { maxChars: 51, overlapChars: 0 });
    for (const chunk of chunks) expect(chunk.text).toMatch(/^(😀)+$/u);
  });
});
