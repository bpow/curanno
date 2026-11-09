import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, databaseUrl, type TestContext } from '../../test/harness.js';
import { createPasswordUser, loadProfile } from './accounts.js';
import { addEmail, listEmails, makePrimary, removeEmail, verifyEmail } from './emails.js';
import { Upstream } from './upstream/service.js';

describe.skipIf(!databaseUrl)('verified email invariants', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  const account = (login: string) =>
    createPasswordUser(ctx.db, 'https://issuer.example', {
      login,
      password: 'a long test passphrase',
    });

  it('does not let an old verification link restore a removed address', async () => {
    const id = await account('removed-email');
    const email = 'removed@example.org';
    await addEmail(ctx.db, id, email);
    expect(await ctx.db.transaction().execute((trx) => removeEmail(trx, id, email))).toBe(true);
    expect(await ctx.db.transaction().execute((trx) => verifyEmail(trx, id, email))).toBe(false);
    expect(await listEmails(ctx.db, id)).toEqual([]);
  });

  it('keeps one primary address when two verification links complete together', async () => {
    const id = await account('concurrent-verification');
    const emails = ['first@example.org', 'second@example.org'];
    for (const email of emails) await addEmail(ctx.db, id, email);
    expect(
      await Promise.all(
        emails.map((email) => ctx.db.transaction().execute((trx) => verifyEmail(trx, id, email))),
      ),
    ).toEqual([true, true]);
    const entries = await listEmails(ctx.db, id);
    expect(entries.every((e) => e.verified)).toBe(true);
    const primary = entries.filter((e) => e.primary);
    expect(primary).toHaveLength(1);
    expect((await loadProfile(ctx.db, id))?.email).toBe(primary[0]?.email);
  });

  it('can verify addresses while two provider identities are attached together', async () => {
    const id = await account('concurrent-provider-links');
    const upstream = new Upstream({
      db: ctx.db,
      origin: 'https://issuer.example',
      auth: ctx.config.auth,
    });
    expect(
      await Promise.all(
        ['one', 'two'].map((subject) =>
          upstream.attach(ctx.db, id, 'oidc', {
            subject,
            email: `${subject}@provider.example`,
            emailVerified: true,
            name: undefined,
          }),
        ),
      ),
    ).toEqual([true, true]);
    const emails = await listEmails(ctx.db, id);
    expect(emails).toHaveLength(2);
    expect(emails.every((e) => e.verified)).toBe(true);
    const primary = emails.filter((e) => e.primary);
    expect(primary).toHaveLength(1);
    expect((await loadProfile(ctx.db, id))?.email).toBe(primary[0]?.email);
  });

  it('keeps the profile consistent when primary selection races with removal', async () => {
    const id = await account('concurrent-primary');
    const first = 'primary-before@example.org';
    const next = 'primary-after@example.org';
    for (const email of [first, next]) {
      await addEmail(ctx.db, id, email);
      await ctx.db.transaction().execute((trx) => verifyEmail(trx, id, email));
    }
    const [selected, removed] = await Promise.all([
      ctx.db.transaction().execute((trx) => makePrimary(trx, id, next)),
      ctx.db.transaction().execute((trx) => removeEmail(trx, id, next)),
    ]);
    expect(selected && removed).toBe(false);
    expect(selected || removed).toBe(true);
    const primary = (await listEmails(ctx.db, id)).filter((e) => e.primary);
    expect(primary).toHaveLength(1);
    expect((await loadProfile(ctx.db, id))?.email).toBe(primary[0]?.email);
  });

  it('does not add a provider address already verified by another account', async () => {
    const owner = await account('email-owner');
    const other = await account('email-other');
    const email = 'owned@example.org';
    expect(
      await ctx.db
        .transaction()
        .execute((trx) => verifyEmail(trx, owner, email, { addIfMissing: true })),
    ).toBe(true);
    expect(
      await ctx.db
        .transaction()
        .execute((trx) => verifyEmail(trx, other, email, { addIfMissing: true })),
    ).toBe(false);
    expect(await listEmails(ctx.db, other)).toEqual([]);
    expect((await loadProfile(ctx.db, other))?.email).toBeUndefined();
  });
});
