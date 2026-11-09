/**
 * Sign-up with approval on the embedded issuer (ADR 0028): an applicant
 * creates an account, signs in and is told they wait; an administrator
 * approves them on the Applications page; they then act as themselves. Runs
 * only with E2E_AUTH=embedded, where alice is an administrator.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { embedded, passwordFor } from '../../api/src/test/e2e-auth.ts';

test.skip(!embedded, 'the embedded issuer only');

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Email or user name').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an applicant waits, an administrator approves, and the applicant can then act', async ({
  browser,
}) => {
  const email = `applicant-${Date.now()}@example.org`;
  const password = 'an-applicants-passphrase';

  const applicant = await (await browser.newContext()).newPage();
  await applicant.goto('/account/signup');
  await expect(applicant.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await applicant.getByLabel('Your name').fill('Ada Applicant');
  await applicant.getByLabel('Email address').fill(email);
  await applicant.getByLabel('Password').fill(password);
  await applicant.getByLabel('Why would you like to join?').fill('To review the family study');
  await expectNoViolations(applicant, 'the sign-up page');
  await applicant.getByRole('button', { name: 'Apply' }).click();
  await expect(applicant.getByRole('status')).toContainText('waiting for an administrator');

  // Signing in works, and says why nothing else does yet.
  await applicant.goto('/groups');
  await signIn(applicant, email, password);
  await expect(applicant).toHaveURL(/\/groups$/);
  await expect(applicant.getByRole('status')).toContainText('waiting for approval');

  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/applications');
  await signIn(admin, 'alice', passwordFor('alice'));
  await expect(admin.getByRole('heading', { name: 'Applications' })).toBeVisible();
  const entry = admin.getByRole('listitem').filter({ hasText: 'Ada Applicant' });
  await expect(entry).toContainText('To review the family study');
  await expectNoViolations(admin, 'the applications page');
  await entry.getByLabel('Message to the applicant').fill('Welcome');
  await entry.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByRole('listitem').filter({ hasText: 'Ada Applicant' })).toHaveCount(0);

  // The API remembers a waiting user for a few seconds, so look again until it notices.
  await expect(async () => {
    await applicant.reload({ waitUntil: 'networkidle' });
    await expect(applicant.getByRole('alert')).toHaveCount(0, { timeout: 1000 });
    await expect(applicant.getByRole('status')).toHaveCount(0, { timeout: 1000 });
  }).toPass({ intervals: [2000], timeout: 30_000 });
  const name = `Applicant group ${Date.now()}`;
  const form = applicant.locator('form', {
    has: applicant.getByRole('button', { name: 'Create' }),
  });
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(applicant).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
});
