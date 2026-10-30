/**
 * Alice signs in through the compose Keycloak, creates a group and adds
 * bob from the membership editor; the result is checked through the API
 * with alice's own token. Bob is signed in once beforehand, through the
 * provider's password grant, so that he exists as a user to add.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ISSUER = process.env['OIDC_ISSUER'] ?? 'http://localhost:8080/realms/annotations-dev';
const CLIENT_ID = process.env['OIDC_CLIENT_ID'] ?? 'annotations-sidebar';

async function tokenFor(request: APIRequestContext, user: 'alice' | 'bob'): Promise<string> {
  const response = await request.post(`${ISSUER}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'password',
      client_id: CLIENT_ID,
      username: user,
      password: user,
      scope: 'openid',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { access_token: string }).access_token;
}

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
  await expect(page.getByRole('heading', { name: 'Annotation platform' })).toBeVisible();
  await expectNoViolations(page, 'the landing page');
});

test('alice creates a group and adds bob', async ({ page, request }) => {
  const bobToken = await tokenFor(request, 'bob');
  const bobMe = await request.get('/x/me', { headers: { authorization: `Bearer ${bobToken}` } });
  expect(bobMe.ok()).toBe(true);
  const bobId = ((await bobMe.json()) as { id: string }).id;

  // The groups page needs a user: the guard sends alice to the provider.
  await page.goto('/groups');
  await page.getByLabel('Username or email').fill('alice');
  await page.getByLabel('Password', { exact: true }).fill('alice');
  await page.getByRole('button', { name: 'Sign In' }).click();
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

  const aliceToken = await tokenFor(request, 'alice');
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
