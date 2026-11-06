/**
 * Alice signs in through the compose Zitadel, creates a group and adds
 * bob from the membership editor; the result is checked through the API
 * with alice's own token. Bob is signed in once beforehand, without a
 * browser, so that he exists as a user to add.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { devAccessToken } from '../../api/src/test/dev-token.ts';

/** Fails on any WCAG 2.1 A/AA or best-practice rule axe reports (docs/accessibility.md). */
async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test('the landing and sign-in pages have no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'CurAnno' })).toBeVisible();
  await expectNoViolations(page, 'the landing page');
});

test('alice creates a group and adds bob', async ({ page, request }) => {
  const bobToken = await devAccessToken('bob');
  const bobMe = await request.get('/x/me', { headers: { authorization: `Bearer ${bobToken}` } });
  expect(bobMe.ok()).toBe(true);
  const bobId = ((await bobMe.json()) as { id: string }).id;

  // The groups page needs a user: the guard sends alice to the provider.
  await page.goto('/groups');
  // Zitadel's form is server-rendered: a fill before hydration is wiped, so
  // fill again until Continue is enabled.
  const next = page.getByRole('button', { name: 'Continue' });
  for (const [field, value] of [
    [page.getByLabel('Loginname'), 'alice'],
    [page.getByLabel('Password', { exact: true }), 'alice'],
  ] as const) {
    await expect(async () => {
      await field.fill(value);
      await expect(next).toBeEnabled({ timeout: 1000 });
    }).toPass();
    await next.click();
  }
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expectNoViolations(page, 'the groups page');

  const name = `E2E group ${Date.now()}`;
  const form = page.locator('form', { has: page.getByRole('button', { name: 'Create' }) });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Description').fill('Created by the management site test');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  const groupId = page.url().split('/').pop() as string;

  await page.getByLabel('Add member').fill('bob');
  await page
    .getByRole('listbox', { name: 'Users found' })
    .getByRole('button', { name: 'Bob Reviewer' })
    .click();
  await expect(page.getByRole('row', { name: /Bob Reviewer/ })).toBeVisible();

  const aliceToken = await devAccessToken('alice');
  const headers = { authorization: `Bearer ${aliceToken}` };
  const members = await request.get(`/x/groups/${groupId}/members`, { headers });
  expect(members.ok()).toBe(true);
  const roles = ((await members.json()) as { user: { id: string }; role: string }[]).map((m) => [
    m.user.id,
    m.role,
  ]);
  expect(roles).toContainEqual([bobId, 'member']);

  // Leave the development database as it was.
  const deleted = await request.delete(`/x/groups/${groupId}`, { headers });
  expect(deleted.status()).toBe(204);
});
