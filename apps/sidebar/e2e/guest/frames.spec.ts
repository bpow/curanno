/**
 * One sidebar, several guests: the bookmarklet runs in a page that embeds a
 * same-origin frame (the host injects the guest into it) and a cross-origin
 * frame whose page loads the guest itself. Each frame's guest reports its
 * own document, the sidebar lists all three documents' annotations, anchor
 * requests reach the right frame, a selection in a frame becomes an
 * annotation on that frame's document, and a removed frame's annotations
 * leave the sidebar.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  API_ORIGIN,
  HOST_ORIGIN,
  PUBLIC_QUOTE,
  SECRETS,
  highlightedTexts,
  injectGuest,
  seedSession,
  selectText,
  stubApi,
  type StubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}/frames.html`;
const SAME_URL = `${HOST_ORIGIN}/cases/synth-overlap/original.html`;
const CROSS_URL = 'http://localhost:4180/framed.html';
const CROSS_ID = `${API_ORIGIN}/annotations/77777777-7777-4777-8777-777777777777`;
const CROSS_QUOTE = 'Second paragraph of the framed document.';
const CROSS_BODY = 'A note inside the cross-origin frame';

let page: Page;
let sidebar: Frame;
let api: StubApi;

function frameOn(url: string): Frame {
  const frame = page.frames().find((f) => f.url() === url);
  if (!frame) throw new Error(`no frame at ${url}`);
  return frame;
}

async function highlightsIn(frame: Frame): Promise<string[]> {
  return frame.evaluate(() =>
    [...(CSS.highlights.get('curanno-annotation') ?? [])].map((r) => (r as Range).toString()),
  );
}

test.beforeEach(async ({ context }) => {
  await seedSession(context);
  // The public annotation is on the same-origin frame's page; another is on the cross-origin one.
  api = await stubApi(context, SAME_URL);
  api.annotations.set(CROSS_ID, {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: CROSS_ID,
    type: 'Annotation',
    creator: { id: `${API_ORIGIN}/x/users/22222222-2222-4222-8222-222222222222`, type: 'Person' },
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    motivation: 'commenting',
    body: { type: 'TextualBody', value: CROSS_BODY, purpose: 'commenting' },
    target: {
      type: 'SpecificResource',
      source: CROSS_URL,
      selector: [{ type: 'TextQuoteSelector', exact: CROSS_QUOTE }],
    },
  });
  page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.waitForLoadState('networkidle');
  sidebar = await injectGuest(page);
});

test('one sidebar serves the page and both of its frames', async () => {
  // Three documents: the page, the same-origin frame (injected) and the cross-origin frame.
  await expect
    .poll(() =>
      [
        ...new Set(
          api.calls
            .filter((c) => c.method === 'GET' && c.url.pathname === '/x/search')
            .map((c) => c.url.searchParams.get('uri')),
        ),
      ].sort(),
    )
    .toEqual([SAME_URL, CROSS_URL, PAGE_URL].sort());
  await expect(sidebar.locator('.document')).toContainText('A page with frames');
  await expect(sidebar.locator('.document .frames')).toContainText('2 framed documents');

  // Annotations of every document, grouped under their document.
  const cards = sidebar.locator('article.card');
  await expect(cards).toHaveCount(2);
  await expect(sidebar.locator('.document-heading')).toHaveCount(2);
  await expect(cards.filter({ hasText: SECRETS.body })).toHaveCount(1);
  await expect(cards.filter({ hasText: CROSS_BODY })).toHaveCount(1);

  // Each frame highlights its own annotation and nothing else.
  await expect.poll(() => highlightsIn(frameOn(SAME_URL))).toEqual([PUBLIC_QUOTE]);
  await expect.poll(() => highlightsIn(frameOn(CROSS_URL))).toEqual([CROSS_QUOTE]);
  expect(await highlightedTexts(page)).toEqual([]);
  expect(
    await page.evaluate(() => document.querySelectorAll('[data-curanno-guest="sidebar"]').length),
  ).toBe(1);
  expect(
    await frameOn(SAME_URL).evaluate(
      () => document.querySelectorAll('[data-curanno-guest="sidebar"]').length,
    ),
  ).toBe(0);

  // Hovering a frame's card focuses its highlight in that frame; clicking its quote scrolls that frame.
  await cards.filter({ hasText: CROSS_BODY }).hover();
  await expect
    .poll(() =>
      frameOn(CROSS_URL).evaluate(() => CSS.highlights.get('curanno-annotation-focus')?.size ?? 0),
    )
    .toBe(1);

  // A selection in the cross-origin frame becomes an annotation on that frame's document.
  await selectText(frameOn(CROSS_URL) as unknown as Page, 'loads the guest itself');
  await expect(sidebar.getByText('loads the guest itself')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Annotate selection' }).click();
  await sidebar.getByLabel('Comment').fill('Noted in the frame');
  await sidebar.getByRole('button', { name: 'Post' }).click();
  await expect(cards).toHaveCount(3);
  const registered = api.calls.find((c) => c.url.pathname === '/x/documents')?.body as {
    uri: string;
  };
  expect(registered.uri).toBe(CROSS_URL);
  const created = api.calls.find((c) => c.url.pathname === '/annotations/')?.body as {
    target: { source: string };
  };
  expect(created.target.source).toBe(CROSS_URL);
  await expect
    .poll(() => highlightsIn(frameOn(CROSS_URL)))
    .toEqual(expect.arrayContaining([CROSS_QUOTE, 'loads the guest itself']));

  // The cross-origin frame is removed: its guest goes, and so do its annotations in the sidebar.
  await page.evaluate(() => document.getElementById('cross')?.remove());
  await expect(cards).toHaveCount(1);
  await expect(sidebar.locator('.document .frames')).toContainText('1 framed document');
  await expect(sidebar.locator('.document-heading')).toHaveCount(1);
});
