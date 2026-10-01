import { db } from '@/core/db';
import { calendarDay } from './period';
import { transition } from './transition';

// P0-8: cancelling is `transition(actor, id, 'cancel')` (active → pending_cancellation, a trial → cancelled at once),
// and the billing run ends it on `currentPeriodEnd` (D-008). Until then the member can take it back.

/** Takes back a cancellation on `asOf`, which must fall before the paid-through date. */
export async function undoCancel(actor: { orgId: string; userId: string | null }, subscriptionId: string, asOf: Date) {
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId, orgId: actor.orgId }, select: { currentPeriodEnd: true } });
  if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
  if (calendarDay(asOf) >= sub.currentPeriodEnd) throw new Error('the paid period has ended; the cancellation can no longer be undone');
  return transition(actor, subscriptionId, 'undo_cancel', undefined, { expect: { currentPeriodEnd: sub.currentPeriodEnd }, set: {} });
}
