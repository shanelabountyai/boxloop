import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, mockCharger, runBilling } from '@/subscriptions/billing-run';
import { updateCard } from '@/subscriptions/dunning';
import { signup } from '@/subscriptions/signup';
import { StaleTransition, transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-4: the daily billing run charges each due period exactly once, via an idempotency key.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function subscribed(trialDays: number, on = '2026-01-31', slug = 'acme') {
  const org = await makeOrg(slug);
  const member = await addMember(org.id, 'member', `m@${slug}.test`);
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

  it('a yearly plan renews on its anchor, Feb 29 falling to Feb 28 and back', async () => {
    const org = await makeOrg('acme');
    const member = await addMember(org.id, 'member', 'm@acme.test');
    const plan = await db.plan.create({ data: { orgId: org.id, name: 'Year', priceCents: 30000, interval: 'year', trialDays: 0 } });
    const sub = await signup({ orgId: org.id, userId: member.id }, plan.id, day('2028-02-29'));
    const billed: string[] = [];
    for (const on of ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-28', '2032-02-29']) {
      const r = await runBilling(day(on));
      if (r.succeeded) billed.push(on);
    }
    expect(billed).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    expect(iso((await row(sub.id)).nextBillingDate)).toBe('2033-02-28');
    expect(await db.chargeAttempt.aggregate({ _sum: { amountCents: true } })).toEqual({ _sum: { amountCents: 150000 } }); // signup + 4 renewals
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

  it('a charge whose record is lost replays on the rerun, even after the card has changed (D-004)', async () => {
    const sub = await subscribed(14); // converts 2026-02-14
    // The provider approves and remembers the key, then the connection drops before the record commits (D-026: the charge is inside that transaction).
    const dropped: Charger = async (i) => (await mockCharger(i), Promise.reject(new Error('connection reset')));
    await expect(runBilling(day('2026-02-14'), dropped)).rejects.toThrow('connection reset');
    expect(await db.chargeAttempt.count()).toBe(0);

    await updateCard({ orgId: sub.orgId, userId: sub.userId }, sub.id, 'declines', day('2026-02-14'));
    const { calls, charge } = spy();
    expect(await runBilling(day('2026-02-14'), charge)).toEqual({ attempted: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual([`${sub.id}:2026-02-14:1`]);
    expect(await row(sub.id)).toMatchObject({ status: 'active', nextBillingDate: day('2026-03-14') });
  });

  it('a provider error stops the run where it is; the rerun charges the rest under the same keys', async () => {
    const subs = [await subscribed(14), await subscribed(14, '2026-01-31', 'b'), await subscribed(14, '2026-01-31', 'c')].sort((a, b) => a.id.localeCompare(b.id));
    const flaky: Charger = async (i) => {
      if (i.subscriptionId === subs[1]!.id) throw new Error('provider timeout');
      return mockCharger(i);
    };
    await expect(runBilling(day('2026-02-14'), flaky)).rejects.toThrow('provider timeout');
    expect((await db.chargeAttempt.findMany()).map((a) => a.subscriptionId)).toEqual([subs[0]!.id]);

    const { calls, charge } = spy();
    expect(await runBilling(day('2026-02-14'), charge)).toEqual({ attempted: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual([`${subs[1]!.id}:2026-02-14:1`, `${subs[2]!.id}:2026-02-14:1`]);
  });

  it('a cancel sent while the charge is in flight waits for the run; no approved charge is left off the ledger (D-026)', async () => {
    // The member's cancel is a separate request: started while the provider is working, and not waited for.
    const approved: string[] = [];
    let cancel: Promise<unknown> = Promise.resolve();
    const cancelling: Charger = async (i) => {
      const s = await row(i.subscriptionId);
      cancel = transition({ orgId: s.orgId, userId: s.userId }, s.id, 'cancel', day('2026-02-14')).catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 50));
      const result = await mockCharger(i);
      if (result.ok) approved.push(result.ref);
      return result;
    };
    const recorded = async () => (await db.chargeAttempt.findMany({ where: { outcome: 'succeeded' } })).map((a) => a.providerRef);

    const trial = await subscribed(14); // converts 2026-02-14
    expect(await runBilling(day('2026-02-14'), cancelling)).toEqual({ attempted: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(await cancel).toBeInstanceOf(StaleTransition); // it read `trialing`; the member is told to look again
    expect(await row(trial.id)).toMatchObject({ status: 'active', nextBillingDate: day('2026-03-14') });
    expect(approved).toHaveLength(1);
    expect(await recorded()).toEqual(approved);

    await resetAuthTables();
    approved.length = 0;
    const paid = await subscribed(0); // paid Jan 31 – Feb 28, by signup
    expect(await runBilling(day('2026-02-28'), cancelling)).toMatchObject({ succeeded: 1, skipped: 0 });
    expect(await cancel).toBe('pending_cancellation'); // lands after the renewal, so it ends the period just paid for
    expect(await row(paid.id)).toMatchObject({ status: 'pending_cancellation', currentPeriodEnd: day('2026-03-31'), nextBillingDate: day('2026-03-31') });
    expect(approved).toHaveLength(1);
    expect(await recorded()).toEqual(expect.arrayContaining(approved));
  });

  it('a subscription cancelled after the run listed it is not charged (D-026)', async () => {
    const subs = [await subscribed(0), await subscribed(0, '2026-01-31', 'b')].sort((a, b) => a.id.localeCompare(b.id));
    const [first, second] = [subs[0]!, subs[1]!];
    // While the run is on the first subscription, the second member cancels: the run's list still says `active`.
    const { calls, charge } = spy(async (i) => {
      if (i.subscriptionId === first.id) await transition({ orgId: second.orgId, userId: second.userId }, second.id, 'cancel', day('2026-02-28'));
      return mockCharger(i);
    });
    expect(await runBilling(day('2026-02-28'), charge)).toEqual({ attempted: 1, succeeded: 1, failed: 0, skipped: 1 });
    expect(calls.map((c) => c.subscriptionId)).toEqual([first.id]);
    expect(await row(second.id)).toMatchObject({ status: 'pending_cancellation', nextBillingDate: day('2026-02-28') });
    expect(await db.chargeAttempt.count({ where: { subscriptionId: second.id } })).toBe(1); // its signup charge only
  });
});
