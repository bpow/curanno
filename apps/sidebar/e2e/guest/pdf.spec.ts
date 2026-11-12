/**
 * A PDF through the viewer app: the viewer on its own origin loads a corpus
 * PDF, its built-in guest reports the file's fingerprint as the document's
 * identity, a stored annotation on page 1 is highlighted in the text layer,
 * an annotation on a page that is not rendered yet is still reported
 * anchored and gets its highlight when the page renders, and a selection
 * in the text layer becomes an annotation whose target names the page.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  API_ORIGIN,
  HOST_ORIGIN,
  SECRETS,
  VIEWER_URL,
  highlightedTexts,
  seedSession,
  selectText,
  sidebarFrame,
  stubApi,
  stubViewerConfig,
  type StubApi,
} from './harness';

const PDF_URL = `${HOST_ORIGIN}/cases/pdf-plos-ten-rules/original.pdf`;
const PAGE_URL = `${VIEWER_URL}?file=${encodeURIComponent(PDF_URL)}`;
/** Page 1 of the PLOS editorial. */
const PAGE_ONE_QUOTE = 'Replication is the cornerstone of a';
/** Page 4, which the viewer renders only when scrolled near. */
const PAGE_FOUR_ID = `${API_ORIGIN}/annotations/66666666-6666-4666-8666-666666666666`;
const PAGE_FOUR_QUOTE = 'Rule 10: Provide Public Access to Scripts, Runs, and Results';
const BODY_FOUR = 'Fourth page note: not visible until the page renders';

function pdfAnnotation(id: string, page: number, exact: string, body: string) {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id,
    type: 'Annotation',
    creator: { id: `${API_ORIGIN}/x/users/22222222-2222-4222-8222-222222222222`, type: 'Person' },
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    motivation: 'commenting',
    body: { type: 'TextualBody', value: body, purpose: 'commenting' },
    target: {
      type: 'SpecificResource',
      source: PDF_URL,
      selector: {
        type: 'FragmentSelector',
        conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
        value: `page=${page}`,
        refinedBy: [{ type: 'TextQuoteSelector', exact }],
      },
    },
  };
}

let page: Page;
let sidebar: Frame;
let api: StubApi;

test.beforeEach(async ({ context }) => {
  await seedSession(context);
  await stubViewerConfig(context);
  api = await stubApi(context, PDF_URL);
  // The stub's first annotation quotes an HTML page; replace it with two PDF ones.
  api.annotations.clear();
  const first = `${API_ORIGIN}/annotations/11111111-1111-4111-8111-111111111111`;
  api.annotations.set(first, pdfAnnotation(first, 1, PAGE_ONE_QUOTE, SECRETS.body));
  api.annotations.set(PAGE_FOUR_ID, pdfAnnotation(PAGE_FOUR_ID, 4, PAGE_FOUR_QUOTE, BODY_FOUR));
  page = await context.newPage();
  await page.goto(PAGE_URL);
  sidebar = await sidebarFrame(page);
});

test('the viewer identifies the PDF by its fingerprint and anchors in the text layer', async () => {
  // The sidebar searched by the PDF's URL, not the viewer's, and shows both annotations.
  await expect
    .poll(() =>
      api.calls
        .find((c) => c.method === 'GET' && c.url.pathname === '/x/search')
        ?.url.searchParams.get('uri'),
    )
    .toBe(PDF_URL);
  const cards = sidebar.locator('article.card');
  await expect(cards).toHaveCount(2);
  // The document shown is the PDF (its metadata title, the publisher's "pcbi.1003285 1..4"), under its URL.
  await expect(sidebar.locator('.document')).toHaveAttribute('title', PDF_URL);
  await expect(sidebar.locator('.document')).toContainText('pcbi.1003285');

  // Page 1 is rendered: its annotation is highlighted in the text layer.
  await expect.poll(() => highlightedTexts(page)).toEqual([PAGE_ONE_QUOTE]);
  // Page 4 is not rendered yet, but the annotation is anchored in its text, not an orphan.
  await expect(cards.filter({ hasText: BODY_FOUR }).locator('.badge')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.querySelector('.page[data-page-number="4"] .textLayer')),
  ).toBeNull();

  // Scrolling the card's quote into view renders the page, and the highlight follows.
  await cards.filter({ hasText: BODY_FOUR }).locator('blockquote').click();
  // (The text layer breaks the line after "Access"; a DOM range's text has no separator there.)
  await expect
    .poll(() => highlightedTexts(page), { timeout: 20_000 })
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Rule 10: Provide Public Access ?to Scripts, Runs, and Results$/),
      ]),
    );
  expect(
    await page.evaluate(() => document.querySelector('.page[data-page-number="4"] .textLayer')),
  ).not.toBeNull();

  // Nothing of the annotations but the quoted text is in the viewer page.
  const html = await page.content();
  expect(html).not.toContain(SECRETS.body);
  expect(html).not.toContain(BODY_FOUR);
  expect(html).not.toContain(SECRETS.token);
});

test('a selection in the text layer becomes an annotation naming the page', async () => {
  await expect.poll(() => highlightedTexts(page)).toEqual([PAGE_ONE_QUOTE]);
  await selectText(page, 'Ten Simple Rules for Reproducible Computational');
  await sidebar.getByRole('button', { name: 'Annotate selection' }).click();
  await sidebar.getByLabel('Comment').fill('A note on the title');
  await sidebar.getByRole('button', { name: 'Post' }).click();
  await expect(sidebar.locator('article.card')).toHaveCount(3);

  const registered = api.calls.find((c) => c.url.pathname === '/x/documents')?.body as {
    uri: string;
    title?: string;
    links: { uri: string; relation: string }[];
  };
  expect(registered.uri).toBe(PDF_URL);
  expect(registered.links.map((l) => l.relation)).toEqual(['self', 'pdf_fingerprint']);
  expect(registered.links[1]?.uri).toMatch(/^urn:x-pdf:[0-9a-f]+$/);
  const created = api.calls.find((c) => c.url.pathname === '/annotations/')?.body as {
    target: {
      source: string;
      selector: { type: string; value: string; refinedBy: { type: string }[] }[];
    };
  };
  expect(created.target.source).toBe(PDF_URL);
  expect(created.target.selector).toHaveLength(1);
  expect(created.target.selector[0]).toMatchObject({ type: 'FragmentSelector', value: 'page=1' });
  expect(created.target.selector[0]?.refinedBy.map((s) => s.type)).toEqual([
    'TextQuoteSelector',
    'TextPositionSelector',
    'RangeSelector',
  ]);
  await expect
    .poll(() => highlightedTexts(page))
    .toEqual(
      expect.arrayContaining([PAGE_ONE_QUOTE, 'Ten Simple Rules for Reproducible Computational']),
    );
});

test('the pages make room for the sidebar as it closes and resizes', async () => {
  await expect(sidebar.locator('article.card')).toHaveCount(2);
  const width = await page.evaluate(() => window.innerWidth);
  const containerRight = () =>
    page.evaluate(() => document.querySelector('.viewerContainer')!.getBoundingClientRect().right);
  const sidebarWidth = await sidebar.evaluate(() => window.innerWidth);
  await expect.poll(containerRight).toBe(width - sidebarWidth);

  // Narrower: the pages take the space it gave up.
  await page.mouse.move(width - sidebarWidth, 300);
  await page.mouse.down();
  await page.mouse.move(width - sidebarWidth + 80, 300, { steps: 5 });
  await page.mouse.up();
  await expect.poll(containerRight).toBe(width - sidebarWidth + 80);

  // Closed: the pages reach the edge.
  await page.getByRole('button', { name: 'Annotations' }).click();
  await expect.poll(containerRight).toBe(width);
});
