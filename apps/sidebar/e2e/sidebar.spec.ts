/**
 * Two users, one document: alice annotates, bob sees nothing until alice
 * shares with him, then follows her edit and deletion live over the event
 * stream, and his guest is asked to anchor and then to unanchor the
 * annotation as it arrives and goes. Uses the development guest (no page)
 * and the compose Zitadel users (or, with E2E_AUTH=embedded, the embedded issuer's); every run annotates a fresh document URI.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { embedded, passwordFor } from '../../api/src/test/e2e-auth.ts';

function freshDocument(): string {
  return `https://example.test/e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const DOCUMENT = freshDocument();

/**
 * Zitadel's login form is server-rendered, so a fill that lands before React
 * hydrates is wiped when it does, leaving Continue disabled. Fill again until
 * the form has accepted the value.
 */
async function fillUntilAccepted(field: Locator, value: string): Promise<void> {
  const next = field.page().getByRole('button', { name: 'Continue' });
  await expect(async () => {
    await field.fill(value);
    await expect(next).toBeEnabled({ timeout: 1000 });
  }).toPass();
}

async function login(page: Page, user: 'alice' | 'bob', document = DOCUMENT): Promise<void> {
  await page.goto(`/sidebar/?uri=${encodeURIComponent(document)}`);
  await page.getByRole('button', { name: 'Log in' }).click();
  if (embedded) {
    // The site's own sign-in page (ADR 0028).
    await page.getByLabel('Email or user name').fill(user);
    await page.getByLabel('Password').fill(passwordFor(user));
    await page.getByRole('button', { name: 'Sign in' }).click();
  } else {
    await fillUntilAccepted(page.getByLabel('Loginname'), user);
    await page.getByRole('button', { name: 'Continue' }).click();
    await fillUntilAccepted(page.getByLabel('Password', { exact: true }), user);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`uri=${encodeURIComponent(document).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
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
  await alice.getByRole('option', { name: 'Bob Reviewer' }).click();
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

test('alice and bob share annotations and replies as they post them', async ({ browser }) => {
  const document = freshDocument();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await login(bob, 'bob', document);
  await login(alice, 'alice', document);

  // Alice shares a page note with bob from the composer, before posting it.
  await alice.getByRole('button', { name: 'New page note' }).click();
  await alice.getByLabel('Comment').fill('Shared from the start');
  await alice.getByText('Sharing').click();
  await alice.getByLabel('Share with').fill('bob');
  await alice.getByRole('option', { name: 'Bob Reviewer' }).click();
  await expect(alice.getByLabel('read for Bob Reviewer')).toBeChecked();
  await alice.getByRole('button', { name: 'Post' }).click();

  const aliceCard = alice.locator('article.card').first();
  await expect(aliceCard).toContainText('Shared from the start');
  await expect(alice.getByRole('alert')).toHaveCount(0);
  const bobCard = bob.locator('article.card').first();
  await expect(bobCard).toContainText('Shared from the start');

  // The grant is the one the composer staged.
  await aliceCard.getByRole('button', { name: 'Share' }).click();
  await expect(aliceCard.getByLabel('read for Bob Reviewer')).toBeChecked();
  await expect(aliceCard.getByLabel('update for Bob Reviewer')).not.toBeChecked();

  // Bob shares his reply with alice as he writes it, so she sees it at once.
  await bobCard.getByRole('button', { name: 'Reply' }).click();
  await bob.getByLabel('Comment').fill('Seen, thanks.');
  await bob.getByText('Sharing').click();
  await bob.getByLabel('Share with').fill('alice');
  await bob.getByRole('option', { name: /^Alice/ }).click();
  await bob.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(bob.locator('article.card.reply')).toContainText('Seen, thanks.');
  await expect(alice.locator('article.card.reply')).toContainText('Seen, thanks.');

  await aliceContext.close();
  await bobContext.close();
});
