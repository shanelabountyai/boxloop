import { db } from '@/core/db';
import { calendarDay, periodIndex, shift } from './period';
import { next } from './state';
import { transition } from './transition';

// P0-7: pause for 1–3 billing periods (D-007). The pause starts at once and the paid period is moved N periods
// later, so the unused paid days come after the pause and the next billing date is exactly N billing dates on.
// The anchor itself never moves, so its day of month survives the pause. The billing run resumes it on `pausedUntil`.

/** Pauses an active subscription on `asOf` for `periods` billing periods. A trial is refused by the state machine. */
export async function pause(actor: { orgId: string; userId: string | null }, subscriptionId: string, periods: number, asOf: Date) {
  if (!Number.isInteger(periods) || periods < 1 || periods > 3) throw new Error('a pause is 1 to 3 billing periods');
  const day = calendarDay(asOf);
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId, orgId: actor.orgId }, include: { plan: { select: { interval: true } } } });
  if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
  next(sub.status, 'pause'); // throws InvalidTransition (trialing, past_due, ...) before any arithmetic
  if (day < sub.currentPeriodStart || day >= sub.currentPeriodEnd) throw new Error('a subscription can pause only inside a paid period');

  const { billingAnchor: anchor, plan } = sub;
  const n = periodIndex(anchor, plan.interval, sub.nextBillingDate) + periods;
  const set = {
    currentPeriodStart: shift(anchor, n - 1, plan.interval),
    currentPeriodEnd: shift(anchor, n, plan.interval),
    nextBillingDate: shift(anchor, n, plan.interval),
    pausedUntil: shift(day, periods, plan.interval),
  };
  await transition(actor, subscriptionId, 'pause', undefined, { expect: { nextBillingDate: sub.nextBillingDate }, set });
  return set;
}
