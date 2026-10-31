/**
 * Annotations of a document reached through another site's address (ADR
 * 0025). The page is linked, as document identity allows, to a document
 * annotated on another origin. Its private annotation is listed in the
 * sidebar but kept from the page, where a hostile script records every
 * message, until the user allows that origin; its public one is
 * highlighted at once.
 */
import { expect, test } from '@playwright/test';
import {
  API_ORIGIN,
  HOST_ORIGIN,
  PAGE_PATH,
  PUBLIC_QUOTE,
  highlightedTexts,
  injectGuest,
  seedSession,
  stubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;
const PUBLISHER_URL = 'https://publisher.test/article';
const PRIVATE_ID = `${API_ORIGIN}/annotations/44444444-4444-4444-8444-444444444444`;
const PUBLIC_ID = `${API_ORIGIN}/annotations/55555555-5555-4555-8555-555555555555`;
const PRIVATE_QUOTE = 'per-annotation permissions';
const OTHER_QUOTE = 'The meeting closed at 16:40.';

declare global {
  interface Window {
    __seen: string[];
  }
}

const RECORDER = `
  if (location.origin === ${JSON.stringify(HOST_ORIGIN)}) {
    window.__seen = [];
    const original = MessagePort.prototype.addEventListener;
    MessagePort.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'message') return original.call(this, type, listener, options);
      return original.call(this, type, (event) => {
        try { window.__seen.push(JSON.stringify(event.data)); } catch {}
        return listener.call(this, event);
      }, options);
    };
  }
`;

function annotationOn(id: string, exact: string, extra: Record<string, unknown> = {}) {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id,
    type: 'Annotation',
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    body: { type: 'TextualBody', value: `A note on ${exact}` },
    target: {
      type: 'SpecificResource',
      source: PUBLISHER_URL,
      selector: [{ type: 'TextQuoteSelector', exact }],
    },
    ...extra,
  };
}

test("another site's annotations reach the page only if public or allowed", async ({ context }) => {
  await seedSession(context);
  await context.addInitScript(RECORDER);
  const api = await stubApi(context, PAGE_URL);
  api.aliases.set(PAGE_URL, PUBLISHER_URL);
  api.annotations.set(PRIVATE_ID, annotationOn(PRIVATE_ID, PRIVATE_QUOTE));
  api.annotations.set(PUBLIC_ID, annotationOn(PUBLIC_ID, OTHER_QUOTE, { public: true }));
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const sidebar = await injectGuest(page);

  // All three are listed; the page's own and the public one are highlighted.
  const cards = sidebar.locator('article.card');
  await expect(cards).toHaveCount(3);
  await expect
    .poll(() => highlightedTexts(page).then((t) => t.sort()))
    .toEqual([PUBLIC_QUOTE, OTHER_QUOTE].sort());
  const kept = cards.filter({ hasText: `A note on ${PRIVATE_QUOTE}` });
  await expect(kept.locator('.badge.elsewhere')).toHaveText('from publisher.test');
  const seen = () => page.evaluate(() => window.__seen.join('\n'));
  expect(await seen()).not.toContain(PRIVATE_ID);

  // Hovering the withheld card names nothing to the page either.
  await kept.hover();
  await page.waitForTimeout(300);
  expect(await seen()).not.toContain(PRIVATE_ID);

  // The user allows publisher.test on this site: the page is sent it and highlights it.
  const prompt = sidebar.getByRole('region', { name: 'Annotations made on publisher.test' });
  await expect(prompt).toContainText('1 annotation here was made on publisher.test');
  await prompt.getByRole('button', { name: 'Highlight on 127.0.0.1:4180' }).click();
  await expect
    .poll(() => highlightedTexts(page).then((t) => t.sort()))
    .toEqual([PUBLIC_QUOTE, OTHER_QUOTE, PRIVATE_QUOTE].sort());
  expect(await seen()).toContain(PRIVATE_ID);
  await expect(prompt).toHaveCount(0);
  await expect(kept.locator('.badge.elsewhere')).toHaveCount(0);

  // The sidebar remembers for the rest of the session: a reload highlights it at once.
  await page.reload();
  await injectGuest(page);
  await expect
    .poll(() => highlightedTexts(page).then((t) => t.sort()))
    .toEqual([PUBLIC_QUOTE, OTHER_QUOTE, PRIVATE_QUOTE].sort());
});
