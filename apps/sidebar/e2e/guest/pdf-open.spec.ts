/**
 * The viewer's open panel, shown when no `?file=` is given: its controls take
 * real clicks (the empty viewer once sat over them) and a file chosen from the
 * computer opens.
 */
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { VIEWER_URL, stubViewerConfig } from './harness';

const PDF_PATH = fileURLToPath(
  new URL(
    '../../../../packages/guest/corpus/cases/pdf-plos-ten-rules/original.pdf',
    import.meta.url,
  ),
);

test('the open panel takes clicks and opens a chosen file', async ({ context }) => {
  await stubViewerConfig(context);
  const page = await context.newPage();
  await page.goto(VIEWER_URL);
  const panel = page.locator('#open');
  await expect(panel).toBeVisible();

  // click() fails its actionability check if another element would receive it.
  await page.getByLabel('URL of a PDF').click();
  await expect(page.getByLabel('URL of a PDF')).toBeFocused();

  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Or a file from your computer').click();
  await (await chooser).setFiles(PDF_PATH);

  await expect(panel).toBeHidden();
  await expect(page.locator('#page-count')).toHaveText('4');
  await expect(page.locator('#title')).toContainText('pcbi.1003285');
});
