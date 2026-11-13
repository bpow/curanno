/**
 * The tag, ontology-term and principal inputs, driven in a real browser: their list and
 * tag behaviour is Reka UI's, which the unit tests' DOM does not run far
 * enough to show (no option is ever highlighted there).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  HOST_ORIGIN,
  PAGE_PATH,
  SIDEBAR_ORIGIN,
  SIDEBAR_URL,
  seedSession,
  stubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;

const PROFILE = {
  iri: 'https://profiles.test/phenotypes/1',
  title: 'Phenotypes',
  builtin: false,
  enabled: true,
  schema: {
    type: 'object',
    properties: {
      phenotypes: {
        title: 'Phenotypes present',
        type: 'array',
        ontology: { name: 'hp' },
        items: {
          type: 'object',
          required: ['label'],
          properties: { id: { type: 'string' }, label: { type: 'string' } },
        },
      },
    },
  },
};

const TERMS = [
  { id: 'HP:0001638', label: 'Cardiomyopathy' },
  { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy', synonym: 'HCM' },
];

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** A composer open on a selection, with a profile that has a term list. */
async function openComposer(context: BrowserContext): Promise<Page> {
  await seedSession(context);
  await stubApi(context, PAGE_URL);
  await context.route(`${SIDEBAR_ORIGIN}/x/profiles`, (route) => route.fulfill(json([PROFILE])));
  await context.route(`${SIDEBAR_ORIGIN}/x/ontologies`, (route) => route.fulfill(json([])));
  await context.route(`${SIDEBAR_ORIGIN}/x/ontologies/hp/terms*`, (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill(json(q.startsWith('card') ? TERMS : []));
  });
  const page = await context.newPage();
  await page.goto(`${SIDEBAR_URL}?uri=${encodeURIComponent(PAGE_URL)}`);
  await page.getByText('Development guest').click();
  await page.getByLabel('Selected text').fill('Two members supported it');
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Annotate selection' }).click();
  return page;
}

test('tags are added with Enter, a comma and on leaving, and removed from the keyboard', async ({
  context,
}) => {
  const page = await openComposer(context);
  const input = page.getByLabel('Add tag');
  const tags = page.locator('.tags .tag');

  await input.fill('  segregation ');
  await input.press('Enter');
  await expect(tags).toHaveText(['segregation×']);
  await expect(input).toHaveValue('');

  await input.pressSequentially('de novo,');
  await expect(tags).toHaveText(['segregation×', 'de novo×']);

  await input.fill('functional');
  await page.getByLabel('Comment').focus();
  await expect(tags).toHaveCount(3);

  // The first Backspace in the empty input marks the last tag, the second removes it.
  await input.focus();
  await input.press('Backspace');
  await expect(tags.last()).toHaveAttribute('data-state', 'active');
  await expect(tags).toHaveCount(3);
  await input.press('Backspace');
  await expect(tags).toHaveText(['segregation×', 'de novo×']);

  // A tag's own button removes it and is named by the tag.
  await page.getByRole('button', { name: 'segregation' }).click();
  await expect(tags).toHaveText(['de novo×']);
});

test('Enter takes the highlighted term, and typed text is kept once the list is dismissed', async ({
  context,
}) => {
  const page = await openComposer(context);
  await page.getByLabel('Structured data').selectOption({ label: 'Phenotypes' });
  const input = page.getByLabel('Phenotypes present');
  const options = page.locator('.suggestions [role="option"]');
  const terms = page.locator('.terms .term');
  const active = () => input.getAttribute('aria-activedescendant');

  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.pressSequentially('cardio');
  await expect(options).toHaveText([
    /^\s*Cardiomyopathy HP:0001638\s*$/,
    /Hypertrophic cardiomyopathy HP:0001639\s*matched “HCM”/,
  ]);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(await input.getAttribute('aria-controls')).toBe(
    await page.locator('.suggestions').getAttribute('id'),
  );

  // The first suggestion is highlighted as soon as the list arrives.
  await expect.poll(active).toBe(await options.nth(0).getAttribute('id'));
  await input.press('ArrowDown');
  await expect.poll(active).toBe(await options.nth(1).getAttribute('id'));
  await input.press('Enter');
  await expect(terms).toHaveText(['Hypertrophic cardiomyopathyHP:0001639×']);
  await expect(input).toHaveValue('');
  await expect(options).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute('aria-activedescendant');

  // Enter alone takes the first suggestion.
  await input.pressSequentially('cardi');
  await expect(options).toHaveCount(2);
  await expect.poll(active).toBe(await options.nth(0).getAttribute('id'));
  await input.press('Enter');
  await expect(terms).toHaveCount(2);
  await expect(terms.nth(1)).toContainText('HP:0001638');

  // A term already in the list is not added twice.
  await input.pressSequentially('cardio');
  await expect(options).toHaveCount(2);
  await options.nth(0).click();
  await expect(terms).toHaveCount(2);
  await expect(input).toHaveValue('');

  // Escape dismisses the suggestions; Enter then keeps what was typed.
  await input.pressSequentially('cardiac flutter');
  await expect(options).toHaveCount(2);
  await input.press('Escape');
  await expect(options).toHaveCount(0);
  await input.press('Enter');
  await expect(terms).toHaveCount(3);
  await expect(terms.nth(2)).toHaveClass(/text/);
  await expect(terms.nth(2)).toHaveText('cardiac flutter×');

  // Text that matches nothing is kept on Enter and on leaving the field.
  await input.pressSequentially('exertional chest pain');
  await input.press('Enter');
  await expect(terms).toHaveCount(4);
  await input.pressSequentially('syncope');
  await page.getByLabel('Comment').focus();
  await expect(terms).toHaveCount(5);
  await expect(terms.nth(4)).toHaveText('syncope×');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);

  // What is posted is the list as shown: picked terms with their IDs, text as written.
  await page.getByLabel('Comment').fill('Presenting features');
  const posted = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/annotations'),
  );
  await page.getByRole('button', { name: 'Post' }).click();
  expect(JSON.stringify((await posted).postDataJSON())).toContain(
    JSON.stringify([
      { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy' },
      { id: 'HP:0001638', label: 'Cardiomyopathy' },
      { label: 'cardiac flutter' },
      { label: 'exertional chest pain' },
      { label: 'syncope' },
    ]),
  );
});

test('the principal search picks with Enter and does not post the form', async ({ context }) => {
  const page = await openComposer(context);
  const people = [
    { id: '77777777-7777-4777-8777-777777777777', kind: 'user', name: 'Bob Reviewer' },
    { id: '88888888-8888-4888-8888-888888888888', kind: 'group', name: 'reviewers' },
  ];
  await context.route(`${SIDEBAR_ORIGIN}/x/principals*`, (route) => route.fulfill(json(people)));
  await page.getByText('Sharing').click();
  const input = page.getByLabel('Share with');
  const options = page.locator('.candidates [role="option"]');

  await input.pressSequentially('rev');
  await expect(options).toHaveText(['Bob Reviewer', 'Group: reviewers']);
  await expect
    .poll(() => input.getAttribute('aria-activedescendant'))
    .toBe(await options.nth(0).getAttribute('id'));
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByLabel('read for Group: reviewers')).toBeChecked();
  await expect(input).toHaveValue('');
  await expect(options).toHaveCount(0);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(page.getByLabel('Comment')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
});
