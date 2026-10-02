import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, runBilling } from '@/subscriptions/billing-run';
import { runDunning, updateCard } from '@/subscriptions/dunning';
import { signup } from '@/subscriptions/signup';
import { transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-6: a failed charge is retried on days 1, 3 and 7, the member is told each time, and day 10 cancels.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });
const declined: Charger = async () => ({ ok: false, reason: 'card_declined' });

/** A trial converting on 2026-02-14 whose conversion charge fails: day 0 of dunning. */
async function failedOn0214() {
  const org = await makeOrg('acme');
  const member = await addMember(org.id, 'member', 'm@acme.test');
  const plan = await db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays: 14 } });
  const sub = await signup({ orgId: org.id, userId: member.id }, plan.id, day('2026-01-31'));
  await runBilling(day('2026-02-14'), declined);
  return { sub, actor: { orgId: org.id, userId: member.id } };
}

const attempts = (subscriptionId: string) =>
  db.chargeAttempt.findMany({ where: { subscriptionId }, orderBy: { attempt: 'asc' }, select: { attempt: true, outcome: true, attemptedOn: true } });

describe('runDunning', () => {
  it('retries on days 1, 3 and 7, notifying each time, then cancels on day 10 as dunning_exhausted', async () => {
    const { sub } = await failedOn0214();
    const runs: Record<string, unknown> = {};
    for (let d = 15; d <= 26; d++) {
      const date = `2026-02-${d}`;
      const r = await runDunning(day(date), declined);
      if (r.retried || r.cancelled) runs[date] = r;
      expect(await runDunning(day(date), declined)).toEqual({ retried: 0, recovered: 0, cancelled: 0, skipped: 0 }); // same day again: nothing
    }
    expect(Object.keys(runs)).toEqual(['2026-02-15', '2026-02-17', '2026-02-21', '2026-02-24']);
    expect(runs['2026-02-24']).toMatchObject({ cancelled: 1 });
    expect((await attempts(sub.id)).map((a) => [a.attempt, iso(a.attemptedOn)])).toEqual([
      [1, '2026-02-14'], [2, '2026-02-15'], [3, '2026-02-17'], [4, '2026-02-21'],
    ]);
    expect((await row(sub.id)).status).toBe('cancelled');

    const outbox = await db.outbox.findMany({ orderBy: { id: 'asc' } });
    expect(outbox).toHaveLength(4); // three retries and the cancellation
    expect(outbox.every((m) => m.to === 'm@acme.test')).toBe(true);
    expect(outbox.map((m) => (m.data as { body: string }).body).join('\n')).toContain('We will try again on 2026-02-17');

    // Reporting tells involuntary churn from voluntary: the audit event name.
    expect(await db.auditEvent.count({ where: { action: 'subscription.dunning_exhausted', targetId: sub.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'subscription.cancel' } })).toBe(0);
  });

  it('a successful retry advances the period, returns to active and closes the sequence', async () => {
    const { sub } = await failedOn0214();
    expect(await runDunning(day('2026-02-15'))).toEqual({ retried: 1, recovered: 1, cancelled: 0, skipped: 0 }); // mock card approves
    const after = await row(sub.id);
    expect(after.status).toBe('active');
    expect([after.currentPeriodStart, after.nextBillingDate].map(iso)).toEqual(['2026-02-14', '2026-03-14']);
    expect(await runDunning(day('2026-02-24'))).toEqual({ retried: 0, recovered: 0, cancelled: 0, skipped: 0 });
    expect((await db.outbox.findFirstOrThrow()).data).toMatchObject({ subject: 'Payment received' });
  });

  it('a late run catches up with one retry, not one per missed day', async () => {
    const { sub } = await failedOn0214();
    expect((await runDunning(day('2026-02-22'), declined)).retried).toBe(1); // days 1, 3 and 7 all missed
    expect((await runDunning(day('2026-02-23'), declined)).retried).toBe(0);
    expect(await attempts(sub.id)).toHaveLength(2);
  });

  it('two runs racing on the same day record one retry between them', async () => {
    const { sub } = await failedOn0214();
    const runs = await Promise.all([runDunning(day('2026-02-15'), declined), runDunning(day('2026-02-15'), declined)]);
    expect(runs.reduce((n, r) => n + r.retried, 0)).toBe(1);
    expect(await attempts(sub.id)).toHaveLength(2);
  });
});

describe('updateCard', () => {
  it('a declining card fails the billing run; updating it retries at once and recovers', async () => {
    const org = await makeOrg('acme');
    const member = await addMember(org.id, 'member', 'm@acme.test');
    const actor = { orgId: org.id, userId: member.id };
    const plan = await db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays: 14 } });
    const sub = await signup(actor, plan.id, day('2026-01-31'));
    await updateCard(actor, sub.id, 'declines', day('2026-02-01'));
    expect((await runBilling(day('2026-02-14'))).failed).toBe(1); // the default mock reads the card

    expect(await updateCard(actor, sub.id, 'approves', day('2026-02-16'))).toBe(true);
    expect((await row(sub.id)).status).toBe('active');
    expect((await attempts(sub.id)).map((a) => [a.attempt, a.outcome])).toEqual([[1, 'failed'], [2, 'succeeded']]);
    expect(await db.auditEvent.findFirst({ where: { action: 'subscription.payment_recovered' } })).toMatchObject({ actorUserId: member.id });
  });

  it('a member retry covers the scheduled one it ran after', async () => {
    const { sub, actor } = await failedOn0214();
    expect(await updateCard(actor, sub.id, 'declines', day('2026-02-16'), declined)).toBe(false); // covers day 1
    expect((await runDunning(day('2026-02-16'), declined)).retried).toBe(0);
    expect((await runDunning(day('2026-02-17'), declined)).retried).toBe(1); // day 3 still runs
    expect(await attempts(sub.id)).toHaveLength(3);
  });

  it('does not retry a subscription that is not past_due, nor touch another org\'s', async () => {
    const { sub, actor } = await failedOn0214();
    await expect(updateCard({ orgId: (await makeOrg('other')).id, userId: null }, sub.id, 'approves', day('2026-02-15'))).rejects.toThrow('not found');
    await updateCard(actor, sub.id, 'approves', day('2026-02-15'));
    expect(await updateCard(actor, sub.id, 'approves', day('2026-02-15'))).toBeNull(); // already active
    expect(await attempts(sub.id)).toHaveLength(2);
  });

  it('a retry whose subscription is cancelled while the charge is in flight is skipped, not recovered', async () => {
    const { sub } = await failedOn0214();
    const cancelling: Charger = async () => {
      await transition({ orgId: sub.orgId, userId: null }, sub.id, 'dunning_exhausted', day('2026-02-15'));
      return { ok: true, ref: 'late' };
    };
    expect(await runDunning(day('2026-02-15'), cancelling)).toEqual({ retried: 0, recovered: 0, cancelled: 0, skipped: 1 });
    expect(await row(sub.id)).toMatchObject({ status: 'cancelled', nextBillingDate: day('2026-02-14') });
  });
});
