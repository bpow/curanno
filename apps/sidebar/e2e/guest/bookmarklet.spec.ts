/**
 * The bookmarklet flow on an HTML page from the corpus: the guest connects
 * the sidebar, the sidebar takes the document from the guest's report and
 * loads its annotations, anchor requests become highlights in the page,
 * highlights drive the cards, and a selection in the page becomes an
 * annotation through the sidebar and the (stubbed) API.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  HOST_ORIGIN,
  PAGE_PATH,
  PUBLIC_ANNOTATION_ID,
  PUBLIC_QUOTE,
  SECRETS,
  highlightCentre,
  highlightedTexts,
  injectGuest,
  injectSource,
  seedSession,
  selectText,
  stubApi,
  type StubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;

let page: Page;
let sidebar: Frame;
let api: StubApi;

test.beforeEach(async ({ context }) => {
  await seedSession(context);
  api = await stubApi(context, PAGE_URL);
  page = await context.newPage();
  await page.goto(PAGE_URL);
  sidebar = await injectGuest(page);
});

test('the sidebar takes the document from the guest and anchors its annotations', async () => {
  // The document identity comes from the guest's report of the page, not from the URL.
  await expect(sidebar.getByText('Minutes of the review board', { exact: true })).toBeVisible();
  const search = api.calls.find((c) => c.method === 'GET' && c.url.pathname === '/x/search');
  expect(search?.url.searchParams.get('uri')).toBe(PAGE_URL);
  expect(search?.authorization).toBe(`Bearer ${SECRETS.token}`);
  expect(sidebar.url()).toBe('http://localhost:4173/sidebar/');

  const card = sidebar.locator('article.card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(SECRETS.body);
  await expect(card).toContainText(PUBLIC_QUOTE);
  await expect(card).toContainText(SECRETS.creator);

  // The anchor request round-tripped: the page shows the highlight, carrying no annotation data.
  await expect.poll(() => highlightedTexts(page)).toEqual([PUBLIC_QUOTE]);
  await expect(card.locator('.badge')).toHaveCount(0);
  const pageHtml = await page.content();
  expect(pageHtml).not.toContain(SECRETS.body);
  expect(pageHtml).not.toContain(PUBLIC_ANNOTATION_ID);
  expect(await page.evaluate(() => document.querySelectorAll('iframe').length)).toBe(0);

  // Pointer over the highlight emphasises the card; a click activates it.
  const at = await highlightCentre(page);
  await page.mouse.move(at.x, at.y);
  await expect(card).toHaveClass(/hovered/);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => sidebar.evaluate(() => document.activeElement?.className ?? ''))
    .toMatch(/card/);

  // Hovering the card focuses the highlight in the page.
  await card.hover();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('scale-annotation-focus')?.size ?? 0))
    .toBe(1);

  // A second click on the bookmarklet toggles the sidebar instead of loading again.
  await page.evaluate(injectSource());
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('[data-scale-guest="sidebar"]')?.hidden ?? null,
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => document.querySelectorAll('script[src$="guest.js"]').length),
  ).toBe(1);
  await page.evaluate(injectSource());
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('[data-scale-guest="sidebar"]')?.hidden ?? null,
      ),
    )
    .toBe(false);
});

test('a selection in the page becomes an annotation through the sidebar', async () => {
  await expect.poll(() => highlightedTexts(page)).toEqual([PUBLIC_QUOTE]);
  await selectText(page, 'Two members supported it');
  await expect(sidebar.getByText('Two members supported it')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Annotate selection' }).click();
  await sidebar.getByLabel('Comment').fill('A note on the fallback');
  await sidebar.getByRole('button', { name: 'Post' }).click();

  const cards = sidebar.locator('article.card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('A note on the fallback');

  // The document was registered from the guest's report before the create.
  const methods = api.calls.filter((c) => c.method === 'POST').map((c) => c.url.pathname);
  expect(methods).toEqual(['/x/documents', '/annotations/']);
  const registered = api.calls.find((c) => c.url.pathname === '/x/documents')?.body as {
    uri: string;
    title?: string;
    links: { uri: string; relation: string }[];
  };
  expect(registered.uri).toBe(PAGE_URL);
  expect(registered.title).toBe('Minutes of the review board');
  expect(registered.links[0]).toEqual({ uri: PAGE_URL, relation: 'self' });
  const created = api.calls.find((c) => c.url.pathname === '/annotations/')?.body as {
    target: { source: string; selector: { type: string }[] };
  };
  expect(created.target.source).toBe(PAGE_URL);
  expect(created.target.selector.map((s) => s.type)).toEqual([
    'TextQuoteSelector',
    'TextPositionSelector',
    'RangeSelector',
  ]);

  // The new annotation was anchored and the page's selection cleared.
  await expect
    .poll(() => highlightedTexts(page))
    .toEqual(expect.arrayContaining([PUBLIC_QUOTE, 'Two members supported it']));
  await expect.poll(() => page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await expect(sidebar.getByRole('button', { name: 'Annotate selection' })).toHaveCount(0);
});
