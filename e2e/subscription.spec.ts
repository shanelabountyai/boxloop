import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Screens 1–4 against the production build: a member subscribes, sees each confirm's money before committing,
// and the operator sees the same subscription read-only with its audit timeline.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());

async function session(user: string, mfa: boolean) {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO "Session" (hash, "userId", "authAt", "mfaAt", "createdAt", "expiresAt") VALUES ($1, $2, now(), ${mfa ? 'now()' : 'NULL'}, now(), now() + interval '1 hour')`,
    [createHash('sha256').update(token).digest('hex'), user],
  );
  return { name: '__Host-session', value: token, domain: 'localhost', path: '/', secure: true };
}

async function seed() {
  const [org, member, owner] = [randomUUID(), randomUUID(), randomUUID()];
  const slug = `e2e-sub-${org.slice(0, 8)}`;
  await db.query('INSERT INTO "Org" (id, slug, name, "updatedAt") VALUES ($1, $2, $2, now())', [org, slug]);
  await db.query(`INSERT INTO "User" (id, email, name, "updatedAt") VALUES ($1, $2, 'Maya Ortiz', now())`, [member, `${slug}-m@example.test`]);
  await db.query(`INSERT INTO "User" (id, email, "totpEnrolledAt", "updatedAt") VALUES ($1, $2, now(), now())`, [owner, `${slug}-o@example.test`]);
  await db.query(`INSERT INTO "Membership" ("orgId", "userId", role, "updatedAt") VALUES ($1, $2, 'member', now()), ($1, $3, 'owner', now())`, [org, member, owner]);
  for (const [name, cents, trial] of [['Pro', 3000, 0], ['Basic', 1500, 0], ['Starter', 1000, 14]] as const) {
    await db.query(`INSERT INTO "Plan" (id, "orgId", name, "priceCents", interval, "trialDays") VALUES ($1, $2, $3, $4, 'month', $5)`, [randomUUID(), org, name, cents, trial]);
  }
  return { slug, member: await session(member, false), owner: await session(owner, true) };
}

test('a member subscribes, previews a downgrade, cancels and undoes it; the operator sees it read-only', async ({ browser }) => {
  const { slug, member, owner } = await seed();
  const m = await (await browser.newContext()).newPage();
  await m.context().addCookies([member]);

  await m.goto(`/o/${slug}`);
  await expect(m).toHaveURL(new RegExp(`/o/${slug}/subscription$`));
  await expect(m.getByRole('heading', { name: 'Choose your plan' })).toBeVisible();
  await expect(m.getByText('No charge today. First charge')).toBeVisible(); // Starter's trial

  // A declined first charge creates nothing (D-015).
  const pro = m.locator('section.card', { has: m.getByRole('heading', { name: 'Pro' }) });
  await pro.getByLabel(/declines this payment/).check();
  await pro.getByRole('button', { name: 'Pay $30.00 and subscribe' }).click();
  await expect(pro.getByRole('alert')).toContainText('no subscription was created');
  await pro.getByLabel(/declines this payment/).uncheck();
  await pro.getByRole('button', { name: 'Pay $30.00 and subscribe' }).click();

  await expect(m.getByRole('heading', { name: 'My subscription' })).toBeVisible();
  await expect(m.locator('.dates')).toContainText(/^Renews \w+ \d+ for \$30\.00$/);
  await expect(m.locator('ul.rows')).toContainText('Succeeded');

  // Downgrade on the signup day: the whole period's difference becomes credit, shown before confirming.
  await m.locator('summary', { hasText: /^Change plan$/ }).click();
  await expect(m.getByText('$15.00 credit goes to your next invoice.')).toBeVisible();
  await m.getByRole('button', { name: 'Switch to Basic' }).click();
  await expect(m.locator('.dates')).toContainText('for $0.00 after $15.00 credit');
  await expect(m.locator('ul.rows')).toContainText('Credit to next invoice');

  await m.locator('summary', { hasText: /^Cancel$/ }).click();
  await expect(m.getByText(/You keep access until \w+ \d+\. Nothing more will be charged\./)).toBeVisible();
  await m.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(m.locator('.pill').first()).toHaveText(/Ending/);
  await m.getByRole('button', { name: 'Undo cancellation' }).click();
  await expect(m.locator('.pill').first()).toHaveText(/Active/);

  // A member does not see the operator's pages.
  await m.goto(`/o/${slug}/subscribers`);
  await expect(m.getByRole('heading', { name: 'Subscribers' })).toHaveCount(0);

  const o = await (await browser.newContext()).newPage();
  await o.context().addCookies([owner]);
  await o.goto(`/o/${slug}`);
  await expect(o).toHaveURL(new RegExp(`/o/${slug}/subscribers$`));
  await o.getByRole('link', { name: /Maya Ortiz/ }).click();
  await expect(o.getByText('Read-only view.')).toBeVisible();
  await expect(o.getByText('Cancel', { exact: true })).toHaveCount(0);
  const timeline = o.locator('ol.timeline');
  await expect(timeline).toContainText('Cancelled by member');
  await expect(timeline).toContainText('Cancellation undone');
  await expect(timeline).toContainText('Changed plan: Pro → Basic');

  // Another org's subscription id reads as not found.
  await o.goto(`/o/${slug}/subscribers/${randomUUID()}`);
  await expect(o.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
