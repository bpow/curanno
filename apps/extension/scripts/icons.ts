/**
 * Draws the toolbar icons, so the repository holds no binary images: a
 * rounded square with three lines of text, the middle one highlighted. The
 * "on" icon is blue, the "off" one grey.
 */
import { crc32, deflateSync } from 'node:zlib';
import { ICON_SIZES } from '../src/pages.ts';

type Rgba = readonly [number, number, number, number];

const PALETTE = {
  on: { tile: [43, 108, 176, 255], mark: [246, 224, 94, 255] },
  off: { tile: [128, 134, 139, 255], mark: [218, 220, 224, 255] },
} as const satisfies Record<string, { tile: Rgba; mark: Rgba }>;
const LINE: Rgba = [255, 255, 255, 255];
const SAMPLES = 4;

function inRoundedSquare(x: number, y: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** The colour at a point of the unit square, or undefined outside the tile. */
function shade(state: keyof typeof PALETTE, x: number, y: number): Rgba | undefined {
  if (!inRoundedSquare(x, y, 0.2)) return undefined;
  const { tile, mark } = PALETTE[state];
  const lines: [number, number][] = [
    [0.28, 0.78],
    [0.22, 0.78],
    [0.22, 0.6],
  ];
  for (const [i, [from, to]] of lines.entries()) {
    const top = 0.27 + i * 0.2;
    if (x >= from && x <= to && y >= top && y <= top + 0.08) return LINE;
  }
  if (x >= 0.16 && x <= 0.84 && y >= 0.4 && y <= 0.62) return mark;
  return tile;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export function iconPng(state: keyof typeof PALETTE, size: number): Buffer {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    rows[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = shade(
            state,
            (px + (sx + 0.5) / SAMPLES) / size,
            (py + (sy + 0.5) / SAMPLES) / size,
          );
          if (!color) continue;
          for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (color[c] ?? 0) * (color[3] / 255);
          sum[3] = (sum[3] ?? 0) + color[3];
        }
      }
      const n = SAMPLES * SAMPLES;
      const alpha = (sum[3] ?? 0) / n;
      const at = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) {
        rows[at + c] = alpha > 0 ? Math.round((sum[c] ?? 0) / n / (alpha / 255)) : 0;
      }
      rows[at + 3] = Math.round(alpha);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const ICON_STATES = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
export { ICON_SIZES };
