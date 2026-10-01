import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, runBilling } from '@/subscriptions/billing-run';
import { runDunning } from '@/subscriptions/dunning';
import { changePlan } from '@/subscriptions/plan-change';
import { signup } from '@/subscriptions/signup';
import { applyCoupon } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P1-2: a percent-off coupon for N paid periods. Discount before credit; it survives a plan change, and
// proration uses the discount the period was paid at.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });
const invoices = (subscriptionId: string) =>
  db.chargeAttempt.findMany({ where: { subscriptionId, outcome: 'succeeded' }, orderBy: { periodStart: 'asc' }, select: { amountCents: true, discountCents: true, creditAppliedCents: true } });

/** A member who signs up on 2026-09-01 to `priceCents`/month, with `trialDays` of trial. */
async function member(priceCents: number, trialDays = 0) {
  const org = await makeOrg('acme');
  const user = await addMember(org.id, 'member', 'm@acme.test');
  const plan = (cents: number) => db.plan.create({ data: { orgId: org.id, name: `${cents}/month`, priceCents: cents, interval: 'month', trialDays } });
  const actor = { orgId: org.id, userId: user.id };
  const sub = await signup(actor, (await plan(priceCents)).id, day('2026-09-01'));
  return { sub, plan, actor };
}

describe('applyCoupon', () => {
  it('discounts exactly N paid periods, then bills full price', async () => {
    const { sub, actor } = await member(2000);
    await applyCoupon(actor, sub.id, 2500, 2, day('2026-09-01'));
    for (const d of ['2026-09-01', '2026-10-01', '2026-11-01']) await runBilling(day(d));
    expect(await invoices(sub.id)).toEqual([
      { amountCents: 1500, discountCents: 500, creditAppliedCents: 0 },
      { amountCents: 1500, discountCents: 500, creditAppliedCents: 0 },
      { amountCents: 2000, discountCents: 0, creditAppliedCents: 0 },
    ]);
    expect(await row(sub.id)).toMatchObject({ couponPeriodsLeft: 0, paidOffBps: 0 });
    expect(await db.auditEvent.count({ where: { action: 'subscription.coupon_applied', targetId: sub.id } })).toBe(1);
  });

  it('does not spend a period on the trial', async () => {
    const { sub, actor } = await member(2000, 14);
    await applyCoupon(actor, sub.id, 5000, 1, day('2026-09-02'));
    await runBilling(day('2026-09-15')); // conversion: the first paid period
    expect(await invoices(sub.id)).toEqual([{ amountCents: 1000, discountCents: 1000, creditAppliedCents: 0 }]);
  });

  it('a failed charge spends nothing; the dunning retry gets the discount and spends the one period', async () => {
    const { sub, actor } = await member(2000);
    await applyCoupon(actor, sub.id, 2500, 1, day('2026-09-01'));
    const declined: Charger = async () => ({ ok: false, reason: 'card_declined' });
    await runBilling(day('2026-09-01'), declined);
    expect(await row(sub.id)).toMatchObject({ status: 'past_due', couponPeriodsLeft: 1 });
    await runDunning(day('2026-09-02'));
    expect(await invoices(sub.id)).toEqual([{ amountCents: 1500, discountCents: 500, creditAppliedCents: 0 }]);
    expect(await row(sub.id)).toMatchObject({ status: 'active', couponPeriodsLeft: 0, paidOffBps: 2500 });
  });

  it('refuses a second live coupon, a bad rate, and another org', async () => {
    const { sub, actor } = await member(2000);
    await applyCoupon(actor, sub.id, 2500, 1, day('2026-09-01'));
    await expect(applyCoupon(actor, sub.id, 1000, 1, day('2026-09-01'))).rejects.toThrow(/already has a coupon/);
    await expect(applyCoupon(actor, sub.id, 0, 1, day('2026-09-01'))).rejects.toThrow(/bps/);
    await expect(applyCoupon(actor, sub.id, 10_001, 1, day('2026-09-01'))).rejects.toThrow(/bps/);
    await expect(applyCoupon(actor, sub.id, 2500, 0, day('2026-09-01'))).rejects.toThrow(/period/);
    const other = await makeOrg('other');
    await expect(applyCoupon({ orgId: other.id, userId: null }, sub.id, 2500, 1, day('2026-09-01'))).rejects.toThrow(/not found/);
  });
});

describe('a coupon meets a plan change', () => {
  it('a downgrade halfway credits the discounted price, and the coupon carries to the new plan before the credit', async () => {
    const { sub, plan, actor } = await member(2000);
    await applyCoupon(actor, sub.id, 2500, 2, day('2026-09-01'));
    await runBilling(day('2026-09-01')); // paid 1500 for Sep 1 – Oct 1 (30 days)
    const basic = await plan(1000);
    const change = await changePlan(actor, sub.id, basic.id, day('2026-09-16'));
    expect(change).toMatchObject({ discountBps: 2500, creditCents: -750, chargeCents: 375, netCents: -375 });
    expect(await row(sub.id)).toMatchObject({ creditCents: 375, couponPeriodsLeft: 1 });

    await runBilling(day('2026-10-01')); // 1000 − 25% = 750, then the 375 credit
    await runBilling(day('2026-11-01'));
    expect((await invoices(sub.id)).slice(1)).toEqual([
      { amountCents: 375, discountCents: 250, creditAppliedCents: 375 },
      { amountCents: 1000, discountCents: 0, creditAppliedCents: 0 },
    ]);
  });

  it('an upgrade charges the discounted difference; after the coupon ends, proration is at list price', async () => {
    const { sub, plan, actor } = await member(2000);
    await applyCoupon(actor, sub.id, 2500, 1, day('2026-09-01'));
    await runBilling(day('2026-09-01'));
    const premium = await plan(4000);
    expect(await changePlan(actor, sub.id, premium.id, day('2026-09-16'))).toMatchObject({ discountBps: 2500, creditCents: -750, chargeCents: 1500, netCents: 750 });

    await runBilling(day('2026-10-01')); // coupon spent: full 4000, paidOffBps back to 0
    const basic = await plan(2000);
    expect(await changePlan(actor, sub.id, basic.id, day('2026-10-16'))).toMatchObject({ discountBps: 0, remainingDays: 16, periodDays: 31, creditCents: -2065, chargeCents: 1032 });
  });
});
