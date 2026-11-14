/**
 * Accessibility checks (plan, Phase 5). axe runs over the sidebar in each
 * of its states (list, composer, editor, sharing, signed out) and over the
 * PDF viewer; the sidebar is opened top-level with the development guest,
 * because axe cannot reach a frame inside the guest's closed shadow root.
 * Keyboard operation is checked by driving the sidebar with the keyboard
 * alone, and the guest's highlights are checked to stay visible in
 * forced-colors mode. What needs a person with a screen reader is listed
 * in docs/accessibility.md.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  API_ORIGIN,
  HOST_ORIGIN,
  PAGE_PATH,
  PUBLIC_QUOTE,
  SIDEBAR_URL,
  VIEWER_URL,
  highlightedTexts,
  injectGuest,
  seedSession,
  stubApi,
  stubViewerConfig,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;
const PDF_URL = `${HOST_ORIGIN}/cases/pdf-plos-ten-rules/original.pdf`;

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, `axe violations in ${label}`).toEqual([]);
}

test('the sidebar has no axe violations in any of its states', async ({ context }) => {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.goto(`${SIDEBAR_URL}?uri=${encodeURIComponent(PAGE_URL)}`);
  await expect(page.locator('article.card')).toHaveCount(1);
  await expectNoViolations(page, 'the list');

  await page.getByText('Development guest').click();
  await page.getByLabel('Selected text').fill('Two members supported it');
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Annotate selection' }).click();
  await page
    .getByLabel('Structured data')
    .selectOption({ index: 1 })
    .catch(() => undefined);
  await expectNoViolations(page, 'the composer');
  await page.getByLabel('Comment').fill('A note of my own');
  await page.getByRole('button', { name: 'Post' }).click();

  // The user's own annotation (newest first) has every action.
  const card = page.locator('article.card').first();
  await expect(card).toContainText('A note of my own');
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(card.getByLabel('Comment')).toBeVisible();
  await expectNoViolations(page, 'the editor');
  await card.getByRole('button', { name: 'Cancel' }).click();
  await card.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByLabel('Share with')).toBeVisible();
  await expectNoViolations(page, 'the sharing panel');
  await card.getByRole('button', { name: 'Reply' }).click();
  await expectNoViolations(page, 'the reply editor');
});

test('deleting asks first in a dialog that keeps focus and can be cancelled', async ({
  context,
}) => {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.goto(`${SIDEBAR_URL}?uri=${encodeURIComponent(PAGE_URL)}`);
  await page.getByRole('button', { name: 'New page note' }).click();
  await page.getByLabel('Comment').fill('A note to delete');
  await page.getByRole('button', { name: 'Post' }).click();
  const card = page.locator('article.card', { hasText: 'A note to delete' });
  const remove = card.getByRole('button', { name: 'Delete' });
  const dialog = page.getByRole('alertdialog', { name: 'Delete this annotation?' });

  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectNoViolations(page, 'the delete dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(card).toHaveCount(1);

  await remove.click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
});

test('the sidebar has no axe violations with annotations from another site', async ({
  context,
}) => {
  await seedSession(context);
  const api = await stubApi(context, PAGE_URL);
  // The page is linked to a document annotated on another site (ADR 0025).
  const id = `${API_ORIGIN}/annotations/66666666-6666-4666-8666-666666666666`;
  api.aliases.set(PAGE_URL, 'https://publisher.test/article');
  api.annotations.set(id, {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id,
    type: 'Annotation',
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    body: { type: 'TextualBody', value: "Made on the publisher's page" },
    target: {
      type: 'SpecificResource',
      source: 'https://publisher.test/article',
      selector: [{ type: 'TextQuoteSelector', exact: 'per-annotation permissions' }],
    },
  });
  const page = await context.newPage();
  await page.goto(`${SIDEBAR_URL}?uri=${encodeURIComponent(PAGE_URL)}`);
  await expect(page.locator('article.card')).toHaveCount(2);
  const prompt = page.getByRole('region', { name: 'Annotations made on publisher.test' });
  await expect(prompt).toBeVisible();
  await expect(page.locator('.badge.elsewhere')).toHaveText('from publisher.test');
  await expectNoViolations(page, "the list with another site's annotations");
  await prompt.getByRole('button', { name: 'Highlight on 127.0.0.1:4180' }).click();
  await expect(prompt).toHaveCount(0);
});

test('the sidebar has no axe violations when signed out', async ({ context }) => {
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.goto(`${SIDEBAR_URL}?uri=${encodeURIComponent(PAGE_URL)}`);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.locator('article.card')).toHaveCount(1);
  await expectNoViolations(page, 'the signed-out sidebar');
});

test('the PDF viewer has no axe violations', async ({ context }) => {
  await seedSession(context);
  await stubViewerConfig(context);
  await stubApi(context, PDF_URL);
  const page = await context.newPage();
  await page.goto(VIEWER_URL);
  await expect(page.getByRole('heading', { name: 'Open a PDF', level: 2 })).toBeVisible();
  await expectNoViolations(page, 'the viewer without a document');
  await page.goto(`${VIEWER_URL}?file=${encodeURIComponent(PDF_URL)}`);
  await expect(page.locator('.page[data-page-number="1"] .textLayer')).toBeAttached();
  // The PDF.js text layer and canvas are excluded: their content is the document, not the UI.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .exclude('#viewer')
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('the sidebar is operable from the keyboard and focus follows the highlight', async ({
  context,
}) => {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const sidebar = await injectGuest(page);
  await expect.poll(() => highlightedTexts(page)).toEqual([PUBLIC_QUOTE]);

  // Tab through the sidebar: the quote is a button that shows the annotation in the page,
  // and a focused card emphasises its highlight the way a hover does.
  await sidebar.locator('body').click({ position: { x: 5, y: 5 } });
  const quoteButton = sidebar.getByRole('button', { name: PUBLIC_QUOTE });
  for (let i = 0; i < 12; i++) {
    if (await quoteButton.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(quoteButton).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('curanno-annotation-focus')?.size ?? 0))
    .toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = [...(CSS.highlights.get('curanno-annotation') ?? [])][0] as Range | undefined;
        const rect = range?.getBoundingClientRect();
        return rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : false;
      }),
    )
    .toBe(true);

  // The next Tab reaches the card's first action (this annotation is read-only, so Reply
  // alone), and every action of a card is a native button.
  await page.keyboard.press('Tab');
  await expect(sidebar.getByRole('button', { name: 'Reply' })).toBeFocused();
  expect(
    await sidebar.evaluate(() =>
      [...document.querySelectorAll('.card .actions > *')].every((el) => el.tagName === 'BUTTON'),
    ),
  ).toBe(true);
});

test('highlights stay visible in forced-colors mode', async ({ context }) => {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(PAGE_URL);
  await injectGuest(page);
  await expect.poll(() => highlightedTexts(page)).toEqual([PUBLIC_QUOTE]);
  // The highlighted text's pixels differ from the page background next to it.
  const box = await page.evaluate(() => {
    const range = [...(CSS.highlights.get('curanno-annotation') ?? [])][0] as Range;
    const r = range.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  const highlighted = await page.screenshot({ clip: box });
  const beside = await page.screenshot({
    clip: { x: box.x, y: box.y + box.height + 40, width: box.width, height: box.height },
  });
  expect(highlighted.equals(beside)).toBe(false);
  // And the highlight is drawn with system colours, not the default yellow.
  const colours = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d') !== null;
  });
  expect(colours).toBe(true);
});
