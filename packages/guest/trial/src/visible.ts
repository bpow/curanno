/** Pixel check: is a highlight painted over each span's text? Shared by the highlight and a11y scripts. */
import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { decodePng, isHighlightColour, pixel } from './png.ts';

type Span = { start: number; end: number };

export async function countVisible(
  page: Page,
  root: string | undefined,
  spans: Span[],
  dump?: string,
): Promise<number> {
  let visible = 0;
  for (const [i, span] of spans.entries()) {
    // probe() scrolls the span into view; screenshot the viewport as it is now.
    const points = await page.evaluate(([r, s]) => window.__trialHl.probe(r, s), [
      root,
      span,
    ] as const);
    if (!points) continue;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const png = await page.screenshot({ animations: 'disabled' });
    if (dump) await writeFile(`${dump}-${i}.png`, png);
    const img = decodePng(png);
    const hit = points.some((p) => isHighlightColour(pixel(img, p.x, p.y)));
    if (dump)
      console.log(
        `  span ${i} ${span.start}-${span.end}: ${hit ? 'visible' : 'not visible'} at ${points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`,
      );
    if (hit) visible++;
  }
  return visible;
}
