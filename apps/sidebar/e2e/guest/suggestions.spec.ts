/**
 * Suggestions on an HTML page (ADR 0032, 0033): the sidebar asks the guest
 * for the page's text, sends it to the configured model endpoint (answered
 * here by a Playwright route standing in for LM Studio or Ollama), shows
 * what came back as dashed highlights in the page, and saves a reviewed
 * suggestion as an ordinary annotation whose body names the model as its
 * creator. Nothing the model said reaches the page.
 */
import { createRequire } from 'node:module';
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  HOST_ORIGIN,
  PAGE_PATH,
  SIDEBAR_ORIGIN,
  injectGuest,
  seedSession,
  stubApi,
  stubSidebarConfig,
  type StubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;
const ENDPOINT = 'http://127.0.0.1:1234';
const PROFILE = 'https://curanno.example/profiles/evidence-excerpt/1';
const FIRST = 'Proposal A keeps the existing service running unchanged for another year.';
const SECOND = 'Proposal B builds a new client on an existing library and writes the server fresh.';
/** In the model's answer only: it must never be sent to the page. */
const SUMMARY = 'MODEL-SUMMARY-SECRET';

const evidenceExcerpt = {
  iri: PROFILE,
  title: 'Evidence excerpt',
  builtin: true,
  enabled: true,
  defaultPurpose: 'classifying',
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['kind'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['case', 'functional', 'other'] },
      summary: { type: 'string', maxLength: 2000 },
    },
  },
};

let page: Page;
let sidebar: Frame;
let api: StubApi;
let modelRequests: { model: string; document: string }[];

test.beforeEach(async ({ context }) => {
  await seedSession(context);
  api = await stubApi(context, PAGE_URL);
  // Routes added later take precedence: a deployment that lists one endpoint, and one profile.
  await stubSidebarConfig(context, {
    extractEndpoints: [{ label: 'LM Studio', url: ENDPOINT, models: ['test-model'] }],
  });
  await context.route(`${SIDEBAR_ORIGIN}/x/profiles`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([evidenceExcerpt]) }),
  );
  modelRequests = [];
  const cors = {
    'access-control-allow-origin': SIDEBAR_ORIGIN,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST',
  };
  await context.route(`${ENDPOINT}/v1/chat/completions`, async (route, request) => {
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = request.postDataJSON() as { model: string; messages: { content: string }[] };
    const user = body.messages[1]?.content ?? '';
    modelRequests.push({ model: body.model, document: user });
    const suggestions = [
      { quote: FIRST, value: { kind: 'other', summary: SUMMARY } },
      { quote: SECOND, value: { kind: 'functional' } },
      { quote: 'A passage the page does not have.', value: { kind: 'case' } },
    ];
    return route.fulfill({
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify({ suggestions }) } }],
      }),
    });
  });
  page = await context.newPage();
  await page.goto(PAGE_URL);
  sidebar = await injectGuest(page);
});

// axe-core as @axe-core/playwright ships it, run inside the sidebar's frame, which sits in the
// host page's closed shadow root.
const axePath = createRequire(
  createRequire(import.meta.url).resolve('@axe-core/playwright'),
).resolve('axe-core/axe.min.js');

async function axeViolations(frame: Frame): Promise<string[]> {
  await frame.addScriptTag({ path: axePath });
  const { violations, passes } = await frame.evaluate(async () => {
    type Result = { id: string }[];
    const { axe } = window as unknown as {
      axe: { run(o: object): Promise<{ violations: Result; passes: Result }> };
    };
    const results = await axe.run({
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
    });
    return { violations: results.violations.map((v) => v.id), passes: results.passes.length };
  });
  // Rules passed, so axe did look at the sidebar.
  expect(passes).toBeGreaterThan(10);
  return violations;
}

function suggestedTexts(): Promise<string[]> {
  return page.evaluate(() =>
    [...(CSS.highlights.get('curanno-suggestion') ?? [])].map((r) => (r as Range).toString()),
  );
}

test('suggestions from the model are highlighted, reviewed and saved with the model as creator', async () => {
  await sidebar.getByRole('button', { name: 'Suggest annotations…' }).click();
  await expect(sidebar.locator('.suggest form')).toContainText('is sent to 127.0.0.1:1234');
  expect(await axeViolations(sidebar), 'axe violations with the suggestion form open').toEqual([]);
  await sidebar.getByRole('button', { name: 'Suggest', exact: true }).click();

  const cards = sidebar.locator('li.suggestion');
  await expect(cards).toHaveCount(2);
  await expect(sidebar.locator('.suggest')).toContainText('1 set aside');
  // The model read the page's text, with its paragraphs.
  expect(modelRequests[0]?.model).toBe('test-model');
  expect(modelRequests[0]?.document).toMatch(/fallback\. ?\n\nProposal B: build on/);
  await expect.poll(suggestedTexts).toEqual([FIRST, SECOND]);

  await cards.first().getByRole('button', { name: 'Review and save' }).click();
  expect(await axeViolations(sidebar), 'axe violations reviewing a suggestion').toEqual([]);
  await cards.first().getByRole('button', { name: 'Save annotation' }).click();
  await expect(cards).toHaveCount(1);
  await expect.poll(suggestedTexts).toEqual([SECOND]);

  const posted = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/annotations/');
  expect(posted?.body).toMatchObject({
    motivation: 'classifying',
    target: {
      source: PAGE_URL,
      selector: [{ type: 'TextQuoteSelector', exact: FIRST }, { type: 'TextPositionSelector' }],
    },
    body: {
      type: 'StructuredBody',
      profile: PROFILE,
      value: { kind: 'other', summary: SUMMARY },
      purpose: 'classifying',
      creator: { type: 'Software', name: 'curanno-extract', nickname: 'test-model / prompt 1' },
    },
  });
  // The saved annotation is now highlighted as an annotation.
  await expect(sidebar.locator('article.card').filter({ hasText: SUMMARY })).toHaveCount(1);

  await cards.first().getByRole('button', { name: 'Discard' }).click();
  await expect(cards).toHaveCount(0);
  await expect.poll(suggestedTexts).toEqual([]);
  // Nothing from the model's answer is in the page.
  expect(await page.content()).not.toContain(SUMMARY);
});
