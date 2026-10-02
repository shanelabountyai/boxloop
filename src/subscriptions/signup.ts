import { randomUUID } from 'node:crypto';
import { audit } from '@/core/audit';
import { db } from '@/core/db';
import { type Charger, chargeInvoice, mockCharger } from './billing-run';
import { calendarDay, signupTerms } from './period';

/** Declined first charge on a no-trial signup: nothing was written. */
export class SignupDeclined extends Error {}

/**
 * Subscribes `actor.userId` to an unarchived plan in `actor.orgId`, as of `asOf` (D-003). Starts `trialing`
 * when the plan has a trial, `active` otherwise: the diagram's two start edges. A no-trial plan's first period
 * is charged here, before anything is written (D-015), so `active` always means paid and a decline creates
 * nothing. The start is audited like any transition. The caller authorises the actor; this only scopes the plan to the org.
 */
export async function signup(actor: { orgId: string; userId: string }, planId: string, asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  const plan = await db.plan.findFirst({ where: { id: planId, orgId: actor.orgId, archivedAt: null } });
  if (!plan) throw new Error(`plan ${planId} is not open for signup`);
  const id = randomUUID(); // known before the row exists, so the charge can carry the usual key
  const paid = plan.trialDays > 0 ? null : await chargeInvoice(charge, { subscriptionId: id, amountCents: plan.priceCents, idempotencyKey: `${id}:${day.toISOString().slice(0, 10)}:1` });
  if (paid && !paid.ok) throw new SignupDeclined(paid.reason);
  return db.$transaction(async (t) => {
    const sub = await t.subscription.create({ data: { id, orgId: actor.orgId, userId: actor.userId, planId, ...signupTerms(plan, day) } });
    if (paid) {
      await t.chargeAttempt.create({ data: { subscriptionId: id, periodStart: day, attempt: 1, amountCents: plan.priceCents, outcome: 'succeeded', providerRef: paid.ref, attemptedOn: day } });
    }
    await audit(actor, 'subscription.created', { targetType: 'subscription', targetId: sub.id, data: { from: null, to: sub.status, planId, on: day.toISOString().slice(0, 10) } }, t);
    return sub;
  });
}
