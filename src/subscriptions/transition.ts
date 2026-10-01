import { audit } from '@/core/audit';
import { db } from '@/core/db';
import type { Prisma, SubscriptionStatus as DbStatus } from '@/generated/prisma/client';
import { next, type SubscriptionEvent, type SubscriptionStatus } from './state';

type Tx = Prisma.TransactionClient;

// The Prisma enum and STATUSES must be the same set; this line stops compiling if either drifts.
const sameSet: [DbStatus, SubscriptionStatus] extends [SubscriptionStatus, DbStatus] ? true : never = true;
void sameSet;

/** Another writer moved the subscription between our read and our write. Safe to retry. */
export class StaleTransition extends Error {}

/**
 * The only writer of Subscription.status (P0-2). Validates `event` against the state machine,
 * updates the row only if its status is still the one read, and audits who/what/when/from/to in
 * the same transaction. Pass `tx` to commit with the caller's other writes. A subscription outside
 * `actor.orgId` reads as missing. `actor.userId` is null for a system job.
 */
export async function transition(
  actor: { orgId: string; userId: string | null },
  subscriptionId: string,
  event: SubscriptionEvent,
  tx?: Tx,
): Promise<SubscriptionStatus> {
  const run = async (t: Tx) => {
    const sub = await t.subscription.findFirst({ where: { id: subscriptionId, orgId: actor.orgId }, select: { status: true } });
    if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
    const to = next(sub.status, event); // throws InvalidTransition before any write
    const { count } = await t.subscription.updateMany({ where: { id: subscriptionId, status: sub.status }, data: { status: to } });
    if (count !== 1) throw new StaleTransition(`subscription ${subscriptionId} changed during ${event}`);
    await audit(actor, `subscription.${event}`, { targetType: 'subscription', targetId: subscriptionId, data: { from: sub.status, to } }, t);
    return to;
  };
  return tx ? run(tx) : db.$transaction(run);
}

/**
 * Moves a paid subscription into `period`, the one it was just charged for (P0-4): the only other write to
 * the row, kept in this file so every Subscription write stays here (D-004). Writes only if
 * `nextBillingDate` is still `period.start`, so a racing run cannot advance the same period twice.
 */
export async function advancePeriod(t: Tx, subscriptionId: string, period: { start: Date; end: Date }) {
  const { count } = await t.subscription.updateMany({
    where: { id: subscriptionId, nextBillingDate: period.start },
    data: { currentPeriodStart: period.start, currentPeriodEnd: period.end, nextBillingDate: period.end },
  });
  if (count !== 1) throw new StaleTransition(`subscription ${subscriptionId} already moved past ${period.start.toISOString().slice(0, 10)}`);
}
