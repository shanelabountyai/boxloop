import { audit } from '@/core/audit';
import { db } from '@/core/db';
import { calendarDay, signupTerms } from './period';

/**
 * Subscribes `actor.userId` to an unarchived plan in `actor.orgId`, as of `asOf` (D-003). Starts `trialing`
 * when the plan has a trial, `active` otherwise: the diagram's two start edges. The start is audited
 * like any transition. The caller authorises the actor; this only scopes the plan to the org.
 */
export async function signup(actor: { orgId: string; userId: string }, planId: string, asOf: Date) {
  return db.$transaction(async (t) => {
    const plan = await t.plan.findFirst({ where: { id: planId, orgId: actor.orgId, archivedAt: null } });
    if (!plan) throw new Error(`plan ${planId} is not open for signup`);
    const sub = await t.subscription.create({
      data: { orgId: actor.orgId, userId: actor.userId, planId, ...signupTerms(plan, asOf) },
    });
    await audit(actor, 'subscription.created', { targetType: 'subscription', targetId: sub.id, data: { from: null, to: sub.status, planId, on: calendarDay(asOf).toISOString().slice(0, 10) } }, t);
    return sub;
  });
}
