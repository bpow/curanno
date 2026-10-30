/**
 * Two users, one document: alice annotates, bob sees nothing until alice
 * shares with him, then follows her edit and deletion live over the event
 * stream, and his guest is asked to anchor and then to unanchor the
 * annotation as it arrives and goes. Uses the development guest (no page)
 * and the compose Keycloak users; every run annotates a fresh document URI.
 */
import { expect, test, type Page } from '@playwright/test';

const DOCUMENT = `https://example.test/e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function login(page: Page, user: 'alice' | 'bob'): Promise<void> {
  await page.goto(`/sidebar/?uri=${encodeURIComponent(DOCUMENT)}`);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByLabel('Username or email').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(user);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`uri=${encodeURIComponent(DOCUMENT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
}

test('alice annotates, shares with bob, and bob follows the changes live', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  // Bob logs in first so that he exists as a principal to share with.
  await login(bob, 'bob');
  await login(alice, 'alice');
  await expect(bob.getByText('No annotations on this document yet.')).toBeVisible();

  // Alice annotates a selection with a comment, a tag and a structured body.
  await alice.getByText('Development guest').click();
  await alice.getByLabel('Selected text').fill('the variant segregated with disease');
  await alice.getByRole('button', { name: 'Select' }).click();
  await alice.getByRole('button', { name: 'Annotate selection' }).click();
  await alice.getByLabel('Comment').fill('Segregation evidence from the family study');
  await alice.getByLabel('Add tag').fill('segregation');
  await alice.getByLabel('Add tag').press('Enter');
  await alice.getByLabel('Structured data').selectOption({ label: 'Evidence excerpt' });
  await alice.locator('select[name="kind"]').selectOption('segregation');
  await alice.getByRole('button', { name: 'Post' }).click();

  const aliceCard = alice.locator('article.card').first();
  await expect(aliceCard).toContainText('Segregation evidence from the family study');
  await expect(aliceCard).toContainText('the variant segregated with disease');
  await expect(aliceCard).toContainText('kind');

  // Bob cannot see it: not shared yet.
  await bob.waitForTimeout(1500);
  await expect(bob.locator('article.card')).toHaveCount(0);

  // Alice grants bob read; bob's sidebar learns about it over the event stream.
  await aliceCard.getByRole('button', { name: 'Share' }).click();
  await alice.getByLabel('Share with').fill('bob');
  await alice.getByRole('button', { name: 'Bob Reviewer' }).click();
  await expect(alice.getByLabel('read for Bob Reviewer')).toBeChecked();
  const bobCard = bob.locator('article.card').first();
  await expect(bobCard).toContainText('Segregation evidence from the family study');
  await expect(bobCard.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  // Bob's guest was asked to anchor it, so a real page would show the highlight.
  await bob.getByText('Development guest').click();
  const bobGuestCalls = bob.getByRole('list', { name: 'Guest calls' });
  await expect(bobGuestCalls).toContainText('anchor 1');

  // Alice edits; bob sees the new text without reloading.
  await aliceCard.getByRole('button', { name: 'Edit' }).click();
  await aliceCard.getByLabel('Comment').fill('Segregation evidence, revised');
  await aliceCard.getByRole('button', { name: 'Save' }).click();
  await expect(aliceCard).toContainText('(edited)');
  await expect(bobCard).toContainText('Segregation evidence, revised');

  // Bob replies. The reply is bob's own annotation with its own ACL (ADR
  // 0006), so alice does not see it until bob shares it.
  await bobCard.getByRole('button', { name: 'Reply' }).click();
  await bob.getByLabel('Comment').fill('Agreed.');
  await bob.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(bob.locator('article.card.reply')).toContainText('Agreed.');
  await alice.waitForTimeout(1000);
  await expect(alice.locator('article.card.reply')).toHaveCount(0);

  // Alice deletes; bob's copy disappears.
  alice.once('dialog', (dialog) => void dialog.accept());
  await aliceCard.getByRole('button', { name: 'Delete' }).click();
  await expect(alice.locator('article.card:not(.reply)')).toHaveCount(0);
  await expect(bob.locator('article.card:not(.reply)')).toHaveCount(0);
  await expect(bobGuestCalls).toContainText('unanchor 1');

  await aliceContext.close();
  await bobContext.close();
});
