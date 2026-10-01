import { audit } from '@/core/audit';
import { db } from '@/core/db';
import type { Prisma, SubscriptionStatus as DbStatus } from '@/generated/prisma/client';
import { next, type SubscriptionEvent, type SubscriptionStatus } from './state';

type Tx = Prisma.TransactionClient;

// The Prisma enum and STATUSES must be the same set; this line stops compiling if either drifts.
const sameSet: [DbStatus, SubscriptionStatus] extends [SubscriptionStatus, DbStatus] ? true : never = true;
void sameSet;

/** Date fields as calendar-day strings, for an audit payload. */
const days = (set: Record<string, Date | null> = {}) => Object.fromEntries(Object.entries(set).map(([k, v]) => [k, v && v.toISOString().slice(0, 10)]));

/** Another writer moved the subscription between our read and our write. Safe to retry. */
export class StaleTransition extends Error {}

/**
 * The only writer of Subscription.status (P0-2). Validates `event` against the state machine,
 * updates the row only if its status is still the one read, and audits who/what/when/from/to in
 * the same transaction. Pass `tx` to commit with the caller's other writes. A subscription outside
 * `actor.orgId` reads as missing. `actor.userId` is null for a system job. `also` writes other fields in
 * the same update, only if the row still matches `also.expect`, and its `set` is audited with the move (P0-7).
 */
export async function transition(
  actor: { orgId: string; userId: string | null },
  subscriptionId: string,
  event: SubscriptionEvent,
  tx?: Tx,
  also?: { expect: Prisma.SubscriptionWhereInput; set: { currentPeriodStart?: Date; currentPeriodEnd?: Date; nextBillingDate?: Date; pausedUntil?: Date | null } },
): Promise<SubscriptionStatus> {
  const run = async (t: Tx) => {
    const sub = await t.subscription.findFirst({ where: { id: subscriptionId, orgId: actor.orgId }, select: { status: true } });
    if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
    const to = next(sub.status, event); // throws InvalidTransition before any write
    const { count } = await t.subscription.updateMany({
      where: { ...also?.expect, id: subscriptionId, status: sub.status },
      data: { ...also?.set, status: to },
    });
    if (count !== 1) throw new StaleTransition(`subscription ${subscriptionId} changed during ${event}`);
    await audit(actor, `subscription.${event}`, { targetType: 'subscription', targetId: subscriptionId, data: { from: sub.status, to, ...days(also?.set) } }, t);
    return to;
  };
  return tx ? run(tx) : db.$transaction(run);
}

/**
 * Moves a paid subscription into `period`, the one it was just charged for (P0-4): the only other write to
 * the row, kept in this file so every Subscription write stays here (D-004). Writes only if
 * `nextBillingDate` is still `period.start`, so a racing run cannot advance the same period twice.
 * `creditUsedCents` is the credit that invoice used up (P0-5), taken off the balance in the same write.
 */
export async function advancePeriod(t: Tx, subscriptionId: string, period: { start: Date; end: Date }, creditUsedCents = 0) {
  const { count } = await t.subscription.updateMany({
    where: { id: subscriptionId, nextBillingDate: period.start, creditCents: { gte: creditUsedCents } },
    data: { currentPeriodStart: period.start, currentPeriodEnd: period.end, nextBillingDate: period.end, creditCents: { decrement: creditUsedCents } },
  });
  if (count !== 1) throw new StaleTransition(`subscription ${subscriptionId} already moved past ${period.start.toISOString().slice(0, 10)}`);
}

/** Records the member's new mock payment method (P0-6), audited; the third write to the row, kept here for D-004. */
export async function setCard(actor: { orgId: string; userId: string | null }, subscriptionId: string, card: 'approves' | 'declines', t: Tx) {
  const { count } = await t.subscription.updateMany({ where: { id: subscriptionId, orgId: actor.orgId }, data: { card } });
  if (count !== 1) throw new Error(`subscription ${subscriptionId} not found`);
  await audit(actor, 'subscription.card_updated', { targetType: 'subscription', targetId: subscriptionId, data: { card } }, t);
}

/**
 * Points the subscription at another plan and adds a downgrade's credit (P0-5), audited with the PlanChange
 * row's id. Writes only if the plan and paid period are still the ones the proration was computed from.
 */
export async function switchPlan(
  actor: { orgId: string; userId: string | null },
  t: Tx,
  read: { id: string; planId: string; currentPeriodStart: Date },
  toPlanId: string,
  creditCents: number,
  planChangeId: string,
) {
  const { count } = await t.subscription.updateMany({
    where: { ...read, orgId: actor.orgId },
    data: { planId: toPlanId, creditCents: { increment: creditCents } },
  });
  if (count !== 1) throw new StaleTransition(`subscription ${read.id} changed during plan change`);
  await audit(actor, 'subscription.plan_changed', { targetType: 'subscription', targetId: read.id, data: { from: read.planId, to: toPlanId, planChangeId } }, t);
}
