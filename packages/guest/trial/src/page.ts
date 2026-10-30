/** Shared Playwright helpers: open a corpus variant and inject the runtime. */
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { BUILD_DIR } from './build.ts';
import { variantUrl, type Case, type Variant } from './corpus.ts';

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

export async function openVariant(
  browser: Browser,
  c: Case,
  v: Variant,
  origin: string,
): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(variantUrl(c, v, origin), { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      !('trialWait' in document.documentElement.dataset) ||
      'trialReady' in document.documentElement.dataset ||
      'trialError' in document.documentElement.dataset,
    undefined,
    { timeout: 60_000 },
  );
  const pageError = await page.evaluate(() => document.documentElement.dataset['trialError']);
  if (pageError) throw new Error(`${c.id}/${v.id}: ${pageError}`);
  if (errors.length > 0) throw new Error(`${c.id}/${v.id}: page errors: ${errors.join('; ')}`);
  await page.addScriptTag({ path: path.join(BUILD_DIR, '__trial/runtime.js') });
  return page;
}

export function rootSelector(c: Case): string | undefined {
  return c.root ?? (c.kind === 'pdf' ? '#viewer' : undefined);
}
