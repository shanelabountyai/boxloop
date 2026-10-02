import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, runBilling } from '@/subscriptions/billing-run';
import { changePlan, PlanChangeDeclined } from '@/subscriptions/plan-change';
import { signup } from '@/subscriptions/signup';
import { StaleTransition, transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-5: a mid-period plan change charges or credits the difference for the rest of the period.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });
const declined: Charger = async () => ({ ok: false, reason: 'card_declined' });

/** Records every amount it is asked to charge, and approves. */
function spy() {
  const amounts: number[] = [];
  const charge: Charger = async (i) => (amounts.push(i.amountCents), { ok: true, ref: `ref_${i.idempotencyKey}` });
  return { amounts, charge };
}

/** A member on `priceCents`/month since 2026-09-01, the first period (Sep 1 – Oct 1, 30 days) paid. */
async function paidSince0901(priceCents: number, trialDays = 0) {
  const org = await makeOrg('acme');
  const member = await addMember(org.id, 'member', 'm@acme.test');
  const plan = (cents: number, interval: 'month' | 'year' = 'month') =>
    db.plan.create({ data: { orgId: org.id, name: `${cents}/${interval}`, priceCents: cents, interval, trialDays } });
  const sub = await signup({ orgId: org.id, userId: member.id }, (await plan(priceCents)).id, day('2026-09-01'));
  await runBilling(day('2026-09-01'));
  return { sub, plan, actor: { orgId: org.id, userId: member.id } };
}

const renewals = (subscriptionId: string) =>
  db.chargeAttempt.findMany({
    where: { subscriptionId, periodStart: { gt: day('2026-09-01') } },
    orderBy: { periodStart: 'asc' },
    select: { amountCents: true, creditAppliedCents: true, providerRef: true },
  });

describe('changePlan', () => {
  it('upgrading $30 → $60 halfway charges $15 now, with the credit and charge as line items', async () => {
    const { sub, plan, actor } = await paidSince0901(3000);
    const premium = await plan(6000);
    const { amounts, charge } = spy();
    const change = await changePlan(actor, sub.id, premium.id, day('2026-09-16'), charge);

    expect(amounts).toEqual([1500]);
    expect(change).toMatchObject({ creditCents: -1500, chargeCents: 3000, netCents: 1500, remainingDays: 15, periodDays: 30, providerRef: `ref_${sub.id}:plan:1` });
    expect(await row(sub.id)).toMatchObject({ planId: premium.id, creditCents: 0 });
    expect(await db.auditEvent.count({ where: { action: 'subscription.plan_changed', targetId: sub.id } })).toBe(1);

    await runBilling(day('2026-10-01'));
    expect(await renewals(sub.id)).toEqual([{ amountCents: 6000, creditAppliedCents: 0, providerRef: `mock_${sub.id}:2026-10-01:1` }]);
  });

  it('downgrading credits the next invoice, never refunds, and the credit is used once', async () => {
    const { sub, plan, actor } = await paidSince0901(6000);
    const basic = await plan(3000);
    const { amounts, charge } = spy();
    expect(await changePlan(actor, sub.id, basic.id, day('2026-09-16'), charge)).toMatchObject({ creditCents: -3000, chargeCents: 1500, netCents: -1500, providerRef: null });
    expect(amounts).toEqual([]); // no cash moves
    expect((await row(sub.id)).creditCents).toBe(1500);

    await runBilling(day('2026-10-01'), charge);
    await runBilling(day('2026-11-01'), charge);
    expect(amounts).toEqual([1500, 3000]);
    expect((await renewals(sub.id)).map((r) => [r.amountCents, r.creditAppliedCents])).toEqual([[1500, 1500], [3000, 0]]);
    expect((await row(sub.id)).creditCents).toBe(0);
  });

  it('a credit bigger than the invoice pays it without a charge and carries the rest over', async () => {
    const { sub, plan, actor } = await paidSince0901(9000);
    await changePlan(actor, sub.id, (await plan(1000)).id, day('2026-09-01')); // whole period: -9000 + 1000
    expect((await row(sub.id)).creditCents).toBe(8000);

    await runBilling(day('2026-10-01'), declined); // a declining card does not matter: nothing is charged
    expect(await renewals(sub.id)).toEqual([{ amountCents: 0, creditAppliedCents: 1000, providerRef: 'credit' }]);
    expect(await row(sub.id)).toMatchObject({ status: 'active', creditCents: 7000 });
  });

  it('a declined upgrade changes nothing', async () => {
    const { sub, plan, actor } = await paidSince0901(3000);
    await expect(changePlan(actor, sub.id, (await plan(6000)).id, day('2026-09-16'), declined)).rejects.toThrow(PlanChangeDeclined);
    expect((await row(sub.id)).planId).toBe(sub.planId);
    expect(await db.planChange.count()).toBe(0);
  });

  it('a trial switches plan without moving money', async () => {
    const { sub, plan, actor } = await paidSince0901(3000, 14);
    const { amounts, charge } = spy();
    expect(await changePlan(actor, sub.id, (await plan(6000)).id, day('2026-09-05'), charge)).toMatchObject({ netCents: 0, creditCents: 0, chargeCents: 0 });
    expect(amounts).toEqual([]);
    expect((await row(sub.id)).creditCents).toBe(0);
  });

  it('rejects a yearly plan, the same plan, and a past_due subscription', async () => {
    const { sub, plan, actor } = await paidSince0901(3000);
    await expect(changePlan(actor, sub.id, (await plan(30000, 'year')).id, day('2026-09-16'))).rejects.toThrow(/monthly and yearly/);
    await expect(changePlan(actor, sub.id, sub.planId, day('2026-09-16'))).rejects.toThrow(/not open/);
    await runBilling(day('2026-10-01'), declined);
    await expect(changePlan(actor, sub.id, (await plan(6000)).id, day('2026-10-02'))).rejects.toThrow(/past_due/);
  });

  it('two changes racing record one between them', async () => {
    const { sub, plan, actor } = await paidSince0901(3000);
    const premium = await plan(6000);
    // Both calls have read the subscription before either writes: the charger releases them together.
    let release!: () => void;
    const bothCharged = new Promise<void>((r) => (release = r));
    let calls = 0;
    const barrier: Charger = async (i) => (++calls === 2 && release(), await bothCharged, { ok: true, ref: i.idempotencyKey });
    const results = await Promise.allSettled([1, 2].map(() => changePlan(actor, sub.id, premium.id, day('2026-09-16'), barrier)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(StaleTransition) });
    expect(await db.planChange.count()).toBe(1);
  });

  it('a cancel landing while the upgrade is charged stops the switch', async () => {
    const { sub, plan, actor } = await paidSince0901(3000);
    const bigger = await plan(6000);
    const cancelling: Charger = async (i) => {
      await transition(actor, sub.id, 'cancel', day('2026-09-16'));
      return { ok: true, ref: `ref_${i.idempotencyKey}` };
    };
    await expect(changePlan(actor, sub.id, bigger.id, day('2026-09-16'), cancelling)).rejects.toThrow(StaleTransition);
    expect(await row(sub.id)).toMatchObject({ status: 'pending_cancellation', planId: sub.planId, creditCents: 0 });
  });
});
