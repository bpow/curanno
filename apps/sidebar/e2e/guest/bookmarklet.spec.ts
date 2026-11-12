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

function sidebarOpen(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () =>
      document
        .querySelector<HTMLElement>('[data-curanno-guest="sidebar"]')
        ?.hasAttribute('data-open') ?? null,
  );
}

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
  await expect(sidebar.locator('.document')).toContainText('Minutes of the review board');
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
    .poll(() => page.evaluate(() => CSS.highlights.get('curanno-annotation-focus')?.size ?? 0))
    .toBe(1);

  // A second click on the bookmarklet toggles the sidebar instead of loading again.
  await page.evaluate(injectSource());
  await expect.poll(() => sidebarOpen(page)).toBe(false);
  expect(
    await page.evaluate(() => document.querySelectorAll('script[src$="guest.js"]').length),
  ).toBe(1);
  await page.evaluate(injectSource());
  await expect.poll(() => sidebarOpen(page)).toBe(true);

  // The tab on the sidebar's edge hides it, and stays on the page's edge to bring it back.
  const width = await page.evaluate(() => window.innerWidth);
  const open = await sidebar.evaluate(() => window.innerWidth);
  await page.mouse.click(width - open - 16, 76);
  await expect.poll(() => sidebarOpen(page)).toBe(false);
  await page.mouse.click(width - 16, 76);
  await expect.poll(() => sidebarOpen(page)).toBe(true);

  // The handle on the sidebar's edge resizes it.
  const before = await sidebar.evaluate(() => window.innerWidth);
  await page.mouse.move(width - before, 300);
  await page.mouse.down();
  await page.mouse.move(width - before - 100, 300, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => sidebar.evaluate(() => window.innerWidth)).toBe(before + 100);

  // The highlights can be hidden and shown again from the sidebar.
  await sidebar.getByRole('button', { name: 'Hide highlights' }).click();
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.has('curanno-annotation')))
    .toBe(false);
  await sidebar.getByRole('button', { name: 'Hide highlights' }).click();
  await expect.poll(() => highlightedTexts(page)).toEqual([PUBLIC_QUOTE]);
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

test('closing the sidebar while it has focus returns focus to the page', async () => {
  const inside = sidebar.getByRole('button', { name: 'Hide highlights' });
  const pageFocus = () =>
    page.evaluate(() => ({
      hasFocus: document.hasFocus(),
      id: document.activeElement?.id ?? '',
      tag: document.activeElement?.tagName ?? '',
    }));

  // Nothing in the page had focus: it goes to the page itself, not the hidden frame.
  await inside.focus();
  await page.evaluate(injectSource());
  await expect.poll(pageFocus).toEqual({ hasFocus: true, id: '', tag: 'BODY' });

  // Otherwise it goes back to the element the user left.
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'page-button';
    button.textContent = 'Page button';
    document.body.prepend(button);
    button.focus();
  });
  await page.evaluate(injectSource());
  await inside.focus();
  await page.evaluate(injectSource());
  await expect.poll(pageFocus).toEqual({ hasFocus: true, id: 'page-button', tag: 'BUTTON' });
});
