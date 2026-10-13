import { audit } from '@/core/audit';
import { db } from '@/core/db';
import { type Charger, chargeInvoice, mockCharger } from './billing-run';
import { calendarDay, iso, signupTerms } from './period';

/** Declined first charge on a no-trial signup: nothing was written. */
export class SignupDeclined extends Error {}
/** The member already has a live subscription in this org (D-025). */
export class AlreadySubscribed extends Error {}

/**
 * Subscribes `actor.userId` to an unarchived plan in `actor.orgId`, as of `asOf` (D-003). Starts `trialing`
 * when the plan has a trial, `active` otherwise: the diagram's two start edges. A no-trial plan's first period
 * is charged here (D-015), inside the transaction that inserts the row, so `active` always means paid and a
 * decline creates nothing. The insert comes first: it claims the member's one live subscription (D-025), so a
 * second signup racing this one waits on it and is refused as `AlreadySubscribed` before its card is charged.
 * The start is audited like any transition. The caller authorises the actor; this only scopes the plan to the org.
 */
export async function signup(actor: { orgId: string; userId: string }, planId: string, asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  const plan = await db.plan.findFirst({ where: { id: planId, orgId: actor.orgId, archivedAt: null } });
  if (!plan) throw new Error(`plan ${planId} is not open for signup`);
  try {
    // ponytail: the provider is called with the transaction open, so a provider slower than Prisma's 5s
    // transaction timeout fails the signup (rolled back; the retry replays nothing, its id is new). Raise the timeout for a real provider.
    return await db.$transaction(async (t) => {
      const sub = await t.subscription.create({ data: { orgId: actor.orgId, userId: actor.userId, planId, ...signupTerms(plan, day) } });
      if (plan.trialDays === 0) {
        const paid = await chargeInvoice(charge, { subscriptionId: sub.id, amountCents: plan.priceCents, idempotencyKey: `${sub.id}:${iso(day)}:1` });
        if (!paid.ok) throw new SignupDeclined(paid.reason); // rolls the row back
        await t.chargeAttempt.create({ data: { subscriptionId: sub.id, periodStart: day, attempt: 1, amountCents: plan.priceCents, outcome: 'succeeded', providerRef: paid.ref, attemptedOn: day } });
      }
      await audit(actor, 'subscription.created', { targetType: 'subscription', targetId: sub.id, data: { from: null, to: sub.status, planId, on: iso(day) } }, t);
      return sub;
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new AlreadySubscribed(`user ${actor.userId} already has a live subscription`);
    throw e;
  }
}
