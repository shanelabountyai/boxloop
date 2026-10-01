import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, mockCharger, runBilling } from '@/subscriptions/billing-run';
import { signup } from '@/subscriptions/signup';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-4: the daily billing run charges each due period exactly once, via an idempotency key.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function subscribed(trialDays: number, on = '2026-01-31') {
  const org = await makeOrg('acme');
  const member = await addMember(org.id, 'member', 'm@acme.test');
  const plan = await db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays } });
  return signup({ orgId: org.id, userId: member.id }, plan.id, day(on));
}

/** The mock, with every call it received recorded. */
function spy(inner: Charger = mockCharger) {
  const calls: Parameters<Charger>[0][] = [];
  const charge: Charger = (i) => (calls.push(i), inner(i));
  return { calls, charge };
}

const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });

describe('runBilling', () => {
  it('converts a trial on its anchor date; the same date again charges nothing', async () => {
    const sub = await subscribed(14); // trial ends 2026-02-14
    const { calls, charge } = spy();
    expect(await runBilling(day('2026-02-13'), charge)).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(await runBilling(day('2026-02-14'), charge)).toEqual({ attempted: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(await runBilling(day('2026-02-14'), charge)).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });

    expect(calls).toEqual([{ subscriptionId: sub.id, amountCents: 3000, idempotencyKey: `${sub.id}:2026-02-14:1` }]);
    const after = await row(sub.id);
    expect(after.status).toBe('active');
    expect([after.currentPeriodStart, after.currentPeriodEnd, after.nextBillingDate].map(iso)).toEqual(['2026-02-14', '2026-03-14', '2026-03-14']);
    expect(await db.chargeAttempt.findMany()).toMatchObject([
      { periodStart: day('2026-02-14'), attempt: 1, amountCents: 3000, outcome: 'succeeded', attemptedOn: day('2026-02-14') },
    ]);
    expect(await db.auditEvent.findFirst({ where: { action: 'subscription.convert' } })).toMatchObject({ actorUserId: null });
  });

  it('renews from the anchor, clamped to short months, and a late run still charges the owed period', async () => {
    const sub = await subscribed(0); // charged at signup: first period 2026-01-31 → 2026-02-28
    await runBilling(day('2026-01-31'));
    expect(iso((await row(sub.id)).nextBillingDate)).toBe('2026-02-28');
    await runBilling(day('2026-03-02')); // two days late
    const after = await row(sub.id);
    expect([after.currentPeriodStart, after.nextBillingDate].map(iso)).toEqual(['2026-02-28', '2026-03-31']);
    expect(await db.chargeAttempt.count()).toBe(2);
  });

  it('a declined charge records the failure and moves the subscription to past_due, period unpaid', async () => {
    const sub = await subscribed(14);
    const declined: Charger = async () => ({ ok: false, reason: 'card_declined' });
    expect(await runBilling(day('2026-02-14'), declined)).toEqual({ attempted: 1, succeeded: 0, failed: 1, skipped: 0 });
    const after = await row(sub.id);
    expect(after.status).toBe('past_due');
    expect(iso(after.nextBillingDate)).toBe('2026-02-14');
    expect(await db.chargeAttempt.findFirst()).toMatchObject({ outcome: 'failed', failureReason: 'card_declined', providerRef: null });
    // past_due is dunning's (P0-6): the next run does not charge it again.
    expect(await runBilling(day('2026-02-15'), declined)).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
  });

  it('never charges paused, past_due or pending_cancellation subscriptions', async () => {
    const sub = await subscribed(0);
    for (const status of ['paused', 'past_due', 'pending_cancellation'] as const) {
      const pausedUntil = status === 'paused' ? day('2026-12-31') : null; // the CHECK requires it exactly while paused
      await db.$executeRaw`UPDATE "Subscription" SET status = ${status}::"SubscriptionStatus", "pausedUntil" = ${pausedUntil}::date WHERE id = ${sub.id}::uuid`;
      expect((await runBilling(day('2026-01-31'))).attempted).toBe(0);
    }
  });

  it('two runs racing on the same date record one charge between them', async () => {
    const sub = await subscribed(14);
    const runs = await Promise.all([runBilling(day('2026-02-14')), runBilling(day('2026-02-14'))]);
    expect(runs.reduce((n, r) => n + r.succeeded, 0)).toBe(1);
    expect(await db.chargeAttempt.count({ where: { subscriptionId: sub.id } })).toBe(1);
    expect(iso((await row(sub.id)).nextBillingDate)).toBe('2026-03-14');
  });

  it('a period already recorded is skipped without calling the provider again', async () => {
    const sub = await subscribed(14);
    await db.chargeAttempt.create({
      data: { subscriptionId: sub.id, periodStart: day('2026-02-14'), attempt: 1, amountCents: 3000, outcome: 'succeeded', attemptedOn: day('2026-02-14') },
    });
    const { calls, charge } = spy();
    expect(await runBilling(day('2026-02-14'), charge)).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
  });
});
