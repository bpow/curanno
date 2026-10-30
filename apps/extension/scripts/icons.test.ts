import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { iconPng } from './icons.ts';

function chunks(png: Buffer): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    found.set(png.toString('latin1', at + 4, at + 8), png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return found;
}

describe('iconPng', () => {
  it('writes an RGBA PNG of the requested size, transparent in the corners', () => {
    const png = iconPng('on', 32);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const parts = chunks(png);
    const header = parts.get('IHDR') as Buffer;
    expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9]]).toEqual([
      32, 32, 8, 6,
    ]);
    const rows = inflateSync(parts.get('IDAT') as Buffer);
    expect(rows.length).toBe(32 * (32 * 4 + 1));
    const alpha = (x: number, y: number): number => rows[y * (32 * 4 + 1) + 1 + x * 4 + 3] ?? -1;
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(16, 4)).toBe(255);
  });

  it('draws the two states differently', () => {
    expect(iconPng('on', 16).equals(iconPng('off', 16))).toBe(false);
  });
});
