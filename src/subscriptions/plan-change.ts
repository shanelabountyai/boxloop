import { db } from '@/core/db';
import { type Charger, mockCharger } from './billing-run';
import { percentOfCents, prorateCents } from './money';
import { calendarDay } from './period';
import { StaleTransition, switchPlan } from './transition';

// P0-5: a mid-period plan change, prorated by calendar day. An upgrade charges the net at once; a downgrade's
// net becomes credit the next invoice uses up (no cash refunds in v1). Plans are immutable (D-001), so a
// change points the subscription at another plan; same interval only, since month↔year is P2.

const DAY_MS = 86_400_000;

/** Declined upgrade charge: nothing was written and the subscription stays on its plan. */
export class PlanChangeDeclined extends Error {}

/** The line items for moving from `fromCents` to `toCents` on `day` of the paid period [start, end). Pure. */
export function prorationLines(fromCents: number, toCents: number, period: { start: Date; end: Date }, day: Date) {
  if (day < period.start || day >= period.end) throw new Error(`${day.toISOString().slice(0, 10)} is outside the paid period`);
  const periodDays = (period.end.getTime() - period.start.getTime()) / DAY_MS;
  const remainingDays = (period.end.getTime() - day.getTime()) / DAY_MS;
  const creditCents = -prorateCents(fromCents, remainingDays, periodDays);
  const chargeCents = prorateCents(toCents, remainingDays, periodDays);
  return { remainingDays, periodDays, creditCents, chargeCents, netCents: creditCents + chargeCents };
}

/**
 * Moves a trialing or active subscription to `toPlanId` on `asOf` (D-003). A trial has paid nothing, so it
 * just switches. An active one is prorated over its current period; a positive net is charged first, with
 * the key `subId:plan:seq`, and only then recorded (D-004), so a declined card changes nothing.
 */
export async function changePlan(actor: { orgId: string; userId: string | null }, subscriptionId: string, toPlanId: string, asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  const sub = await db.subscription.findFirst({
    where: { id: subscriptionId, orgId: actor.orgId },
    include: { plan: true, _count: { select: { planChanges: true } } },
  });
  if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
  const to = await db.plan.findFirst({ where: { id: toPlanId, orgId: actor.orgId, archivedAt: null } });
  if (!to || to.id === sub.planId) throw new Error(`plan ${toPlanId} is not open to switch to`);
  if (to.interval !== sub.plan.interval) throw new Error('switching between monthly and yearly plans is not supported');
  if (sub.status !== 'trialing' && sub.status !== 'active') throw new Error(`a ${sub.status} subscription cannot change plan`);

  const period = { start: sub.currentPeriodStart, end: sub.currentPeriodEnd };
  // Both sides at the discount the period was paid at (P1-2), so a downgrade never credits more than was paid.
  const discountBps = sub.status === 'active' ? sub.paidOffBps : 0;
  const paidPrice = (cents: number) => (sub.status === 'active' ? cents - percentOfCents(cents, discountBps) : 0);
  const lines = prorationLines(paidPrice(sub.plan.priceCents), paidPrice(to.priceCents), period, day);
  const seq = sub._count.planChanges + 1;
  let providerRef: string | null = null;
  if (lines.netCents > 0) {
    // ponytail: the key is per change number, so a retry after a crash replays; a provider that checks amounts would reject a retry to a different plan.
    const result = await charge({ subscriptionId, amountCents: lines.netCents, idempotencyKey: `${subscriptionId}:plan:${seq}` });
    if (!result.ok) throw new PlanChangeDeclined(result.reason);
    providerRef = result.ref;
  }
  try {
    return await db.$transaction(async (t) => {
      const change = await t.planChange.create({
        data: { subscriptionId, seq, fromPlanId: sub.planId, toPlanId, effectiveOn: day, providerRef, discountBps, ...lines },
      });
      await switchPlan(actor, t, { id: subscriptionId, planId: sub.planId, currentPeriodStart: sub.currentPeriodStart }, toPlanId, Math.max(0, -lines.netCents), change.id, day);
      return change;
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new StaleTransition(`subscription ${subscriptionId} changed plan concurrently`);
    throw e;
  }
}
