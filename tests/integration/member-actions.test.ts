import { beforeEach, describe, expect, it } from 'vitest';
import { cancelMine, pauseMine, subscribe, switchMyPlan, undoMine, updateMyCard } from '@/app/o/[org]/subscription/actions';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { runBilling } from '@/subscriptions/billing-run';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

// Screen 1's server actions (D-023): the member acts only on their own newest subscription, and billing
// errors come back as the board's wording instead of a thrown error. The billing functions underneath are
// covered by their own tests; these check the action layer: scoping, refusals and the error mapping.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Pins the clock to noon UTC on `iso` (the actions are entry points and read it, D-003) and signs `userId` in. */
async function on(iso: string, userId: string, slug: string) {
  advanceClock(day(iso).getTime() + 12 * 3600_000 - Date.now());
  await actAs(userId, slug);
}

const plan = (orgId: string, over: Partial<{ name: string; priceCents: number; interval: 'month' | 'year'; trialDays: number; archivedAt: Date }> = {}) =>
  db.plan.create({ data: { orgId, name: 'Box', priceCents: 3000, interval: 'month', trialDays: 0, ...over } });

async function setup() {
  const org = await makeOrg('acme');
  const ada = await addMember(org.id, 'member', 'ada@acme.test');
  const bob = await addMember(org.id, 'member', 'bob@acme.test');
  const monthly = await plan(org.id);
  return { org, ada, bob, monthly };
}

const subsOf = (userId: string) => db.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
const redirected = (slug: string) => ({ kind: 'redirect', to: `/o/${slug}/subscription` });

describe('subscribe', () => {
  it('a no-trial plan is paid on signup and the member lands on their subscription', async () => {
    const { org, ada, monthly } = await setup();
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toMatchObject(redirected(org.slug));
    const [sub] = await subsOf(ada.id);
    expect(sub).toMatchObject({ status: 'active', planId: monthly.id, currentPeriodStart: day('2026-03-10'), nextBillingDate: day('2026-04-10') });
    expect(await db.chargeAttempt.count({ where: { subscriptionId: sub!.id, outcome: 'succeeded' } })).toBe(1);
  });

  it('a declined first charge creates nothing and says so', async () => {
    const { org, ada, monthly } = await setup();
    await on('2026-03-10', ada.id, org.slug);
    expect(await subscribe(org.slug, { planId: monthly.id, card: 'declines' })).toEqual({ error: 'Your card was declined, so no subscription was created. Try another card.' });
    expect(await subsOf(ada.id)).toEqual([]);
    expect(await db.auditEvent.count({ where: { action: 'subscription.created' } })).toBe(0);
  });

  it('refuses a second live subscription, an archived plan, and an unknown card value', async () => {
    const { org, ada, monthly } = await setup();
    const retired = await plan(org.id, { name: 'Old', archivedAt: day('2026-01-01') });
    await on('2026-03-10', ada.id, org.slug);
    expect(await subscribe(org.slug, { planId: retired.id })).toEqual({ error: 'That plan is no longer offered.' });
    expect(await subscribe(org.slug, { planId: monthly.id, card: 'stolen' })).toHaveProperty('error');
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal);
    expect(await subscribe(org.slug, { planId: monthly.id })).toEqual({ error: 'You already have a subscription.' });
    expect(await subsOf(ada.id)).toHaveLength(1);
  });

  it("another org's plan is not found, and nothing is created or charged", async () => {
    const { org, ada } = await setup();
    const theirs = await plan((await makeOrg('other')).id);
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: theirs.id })).rejects.toMatchObject({ kind: 'notFound' });
    expect(await db.subscription.count()).toBe(0);
    expect(await db.chargeAttempt.count()).toBe(0);
  });
});

describe('acting on my subscription', () => {
  it('with no subscription, every action says so', async () => {
    const { org, ada } = await setup();
    await on('2026-03-10', ada.id, org.slug);
    const none = { error: 'You have no subscription yet.' };
    expect(await cancelMine(org.slug, {})).toEqual(none);
    expect(await undoMine(org.slug, {})).toEqual(none);
    expect(await pauseMine(org.slug, { periods: '1' })).toEqual(none);
    expect(await updateMyCard(org.slug, { card: 'approves' })).toEqual(none);
    const other = await plan(org.id, { name: 'Big', priceCents: 6000 });
    expect(await switchMyPlan(org.slug, { planId: other.id })).toEqual(none);
  });

  it("cancelling touches only the caller's own subscription", async () => {
    const { org, ada, bob, monthly } = await setup();
    await on('2026-03-10', bob.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal);
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal);

    await on('2026-03-12', ada.id, org.slug);
    await expect(cancelMine(org.slug, {})).rejects.toMatchObject(redirected(org.slug));
    expect((await subsOf(ada.id)).map((s) => s.status)).toEqual(['pending_cancellation']);
    expect((await subsOf(bob.id)).map((s) => s.status)).toEqual(['active']);
  });

  it('acts on the newest subscription after a resubscribe, never the ended one', async () => {
    const { org, ada } = await setup();
    const trial = await plan(org.id, { name: 'Trial box', trialDays: 14 });
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: trial.id })).rejects.toBeInstanceOf(NavSignal);
    await expect(cancelMine(org.slug, {})).rejects.toBeInstanceOf(NavSignal); // a trial cancels at once (D-002)
    await expect(subscribe(org.slug, { planId: trial.id })).rejects.toBeInstanceOf(NavSignal);
    await expect(cancelMine(org.slug, {})).rejects.toBeInstanceOf(NavSignal);
    expect((await subsOf(ada.id)).map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(await cancelMine(org.slug, {})).toHaveProperty('error'); // the newest is cancelled; no edge out of it
  });

  it('pausing: a trial gets the board wording, the length is 1–3, and the renewal day is refused (D-020)', async () => {
    const { org, ada, monthly } = await setup();
    const trial = await plan(org.id, { name: 'Trial box', trialDays: 14 });
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: trial.id })).rejects.toBeInstanceOf(NavSignal);
    expect(await pauseMine(org.slug, { periods: '1' })).toEqual({ error: 'Pausing is not available during a trial. You can cancel instead and nothing will be charged.' });
    await expect(cancelMine(org.slug, {})).rejects.toBeInstanceOf(NavSignal);

    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal); // paid Mar 10 – Apr 10
    for (const periods of ['0', '4', 'two']) expect(await pauseMine(org.slug, { periods })).toHaveProperty('error');
    await on('2026-04-10', ada.id, org.slug); // the renewal day, before the run
    expect(await pauseMine(org.slug, { periods: '2' })).toEqual({ error: 'Your renewal is being processed today. Try again tomorrow.' });
    await on('2026-03-20', ada.id, org.slug);
    await expect(pauseMine(org.slug, { periods: '2' })).rejects.toMatchObject(redirected(org.slug));
    expect((await subsOf(ada.id)).at(-1)).toMatchObject({ status: 'paused', nextBillingDate: day('2026-06-10') });
  });

  it('undo works before the paid-through date and is refused on it', async () => {
    const { org, ada, monthly } = await setup();
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal);
    await expect(cancelMine(org.slug, {})).rejects.toBeInstanceOf(NavSignal);
    await expect(undoMine(org.slug, {})).rejects.toMatchObject(redirected(org.slug));
    expect((await subsOf(ada.id))[0]!.status).toBe('active');

    await expect(cancelMine(org.slug, {})).rejects.toBeInstanceOf(NavSignal);
    await on('2026-04-10', ada.id, org.slug);
    expect(await undoMine(org.slug, {})).toEqual({ error: 'Your paid period has ended, so the cancellation can no longer be undone.' });
    expect((await subsOf(ada.id))[0]!.status).toBe('pending_cancellation');
  });

  it('switching plan: monthly to yearly is refused in words; an upgrade is prorated onto the same subscription', async () => {
    const { org, ada, monthly } = await setup();
    const yearly = await plan(org.id, { name: 'Year', priceCents: 30000, interval: 'year' });
    const big = await plan(org.id, { name: 'Big', priceCents: 6000 });
    await on('2026-04-01', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal); // Apr 1 – May 1, 30 days
    expect(await switchMyPlan(org.slug, { planId: yearly.id })).toEqual({ error: 'Switching between monthly and yearly plans is not available.' });

    await on('2026-04-16', ada.id, org.slug); // 15 of 30 days left
    await expect(switchMyPlan(org.slug, { planId: big.id })).rejects.toMatchObject(redirected(org.slug));
    const [sub] = await subsOf(ada.id);
    expect(sub!.planId).toBe(big.id);
    expect(await db.planChange.findFirstOrThrow({ where: { subscriptionId: sub!.id } })).toMatchObject({ creditCents: -1500, chargeCents: 3000, netCents: 1500 });
  });

  it('a past-due member who updates to a declining card is told, and the failed retry is recorded; a good card recovers', async () => {
    const { org, ada, monthly } = await setup();
    await on('2026-03-10', ada.id, org.slug);
    await expect(subscribe(org.slug, { planId: monthly.id })).rejects.toBeInstanceOf(NavSignal);
    await expect(updateMyCard(org.slug, { card: 'declines' })).rejects.toMatchObject(redirected(org.slug)); // active: nothing to retry
    await runBilling(day('2026-04-10')); // the renewal declines on the saved card
    const [sub] = await subsOf(ada.id);
    expect(sub!.status).toBe('past_due');

    await on('2026-04-11', ada.id, org.slug);
    expect(await updateMyCard(org.slug, { card: 'declines' })).toEqual({ error: 'Your card was declined again. Try another card.' });
    expect(await db.chargeAttempt.count({ where: { subscriptionId: sub!.id, periodStart: day('2026-04-10'), outcome: 'failed' } })).toBe(2);

    await expect(updateMyCard(org.slug, { card: 'approves' })).rejects.toMatchObject(redirected(org.slug));
    expect(await db.subscription.findUniqueOrThrow({ where: { id: sub!.id } })).toMatchObject({ status: 'active', nextBillingDate: day('2026-05-10') });
  });
});
