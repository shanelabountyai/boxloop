import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { enqueue } from '@/modules/notifications/outbox';
import { type Charger, mockCharger } from './billing-run';
import { addDays, calendarDay, periodFrom } from './period';
import { advancePeriod, setCard, StaleTransition, transition } from './transition';

// P0-6: dunning. A past_due subscription owes the period starting at nextBillingDate; day 0 is its failed
// attempt 1 (the billing run). Retries fall on days 1, 3 and 7, each notifies the member through the
// outbox, and day 10 cancels it as `dunning_exhausted`, kept apart from a voluntary `cancel` (D-005).

export const RETRY_DAYS = [1, 3, 7];
export const CANCEL_DAY = 10;

type Actor = { orgId: string; userId: string | null };
type PastDue = Prisma.SubscriptionGetPayload<{ include: { plan: true; user: true; chargeAttempts: true } }>;

const iso = (day: Date) => day.toISOString().slice(0, 10);
const loadPastDue = (where: Prisma.SubscriptionWhereInput) =>
  db.subscription.findMany({
    where: { ...where, status: 'past_due' },
    include: { plan: true, user: true, chargeAttempts: { orderBy: { attempt: 'asc' } } },
    orderBy: { id: 'asc' },
  });

/** The unpaid period's attempts, and its day 0. Null when the period has no failed attempt 1 to count from. */
function sequence(sub: PastDue) {
  const attempts = sub.chargeAttempts.filter((a) => a.periodStart.getTime() === sub.nextBillingDate.getTime());
  const first = attempts.find((a) => a.attempt === 1 && a.outcome === 'failed');
  return first && { attempts, day0: first.attemptedOn };
}

const notify = (sub: PastDue, subject: string, body: string, t: Prisma.TransactionClient) =>
  enqueue({ channel: 'email', to: sub.user.email, template: 'notice', orgId: sub.orgId, data: { subject, body } }, t);

/**
 * Charges the unpaid period once more, as the next attempt number, and notifies the member of the outcome.
 * Success advances the period and returns the subscription to active in the same transaction. Returns
 * null when another writer got there first (the attempt number was taken, or the subscription moved).
 */
async function retry(actor: Actor, sub: PastDue, asOf: Date, charge: Charger) {
  const seq = sequence(sub);
  if (!seq) return null;
  const attempt = seq.attempts.at(-1)!.attempt + 1;
  const key = { subscriptionId: sub.id, periodStart: sub.nextBillingDate, attempt };
  const amountCents = sub.plan.priceCents;
  // Charged before recording, as in the billing run (D-004): a lost write replays at the provider.
  const result = await charge({ subscriptionId: sub.id, amountCents, idempotencyKey: `${sub.id}:${iso(key.periodStart)}:${attempt}` });
  const next = RETRY_DAYS.map((d) => addDays(seq.day0, d)).find((d) => d > asOf);
  try {
    await db.$transaction(async (t) => {
      await t.chargeAttempt.create({
        data: { ...key, amountCents, outcome: result.ok ? 'succeeded' : 'failed', providerRef: result.ok ? result.ref : null, failureReason: result.ok ? null : result.reason, attemptedOn: asOf },
      });
      if (!result.ok) {
        const cancels = iso(addDays(seq.day0, CANCEL_DAY));
        return void (await notify(sub, 'Payment failed again', `We could not charge your card. ${next ? `We will try again on ${iso(next)}. ` : ''}Your subscription cancels on ${cancels} unless payment goes through. Updating your payment method retries it now.`, t));
      }
      await advancePeriod(t, sub.id, periodFrom(sub.billingAnchor, sub.plan.interval, key.periodStart));
      await transition(actor, sub.id, 'payment_recovered', t);
      await notify(sub, 'Payment received', 'Your payment went through. Your subscription is active again.', t);
    });
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002' && !(e instanceof StaleTransition)) throw e;
    return null;
  }
  return result.ok;
}

/**
 * The daily dunning pass for `asOf` (D-003). Each past_due subscription gets at most one retry per run: the
 * latest scheduled day on or before `asOf` that no attempt has covered yet, so a late run catches up with
 * one charge, not several. On or after day 10 it is cancelled instead.
 */
export async function runDunning(asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  const summary = { retried: 0, recovered: 0, cancelled: 0, skipped: 0 };
  for (const sub of await loadPastDue({})) {
    const seq = sequence(sub);
    if (!seq) continue;
    const system = { orgId: sub.orgId, userId: null };
    if (day >= addDays(seq.day0, CANCEL_DAY)) {
      try {
        await db.$transaction(async (t) => {
          await transition(system, sub.id, 'dunning_exhausted', t);
          await notify(sub, 'Subscription cancelled', 'We could not collect payment after several tries, so your subscription has been cancelled.', t);
        });
        summary.cancelled++;
      } catch (e) {
        if (!(e instanceof StaleTransition)) throw e;
        summary.skipped++;
      }
      continue;
    }
    const lastAttemptOn = seq.attempts.at(-1)!.attemptedOn;
    const due = RETRY_DAYS.map((d) => addDays(seq.day0, d)).filter((d) => d <= day).at(-1);
    if (!due || lastAttemptOn >= due) continue; // nothing scheduled yet, or an attempt (maybe a member's) already covered it
    const ok = await retry(system, sub, day, charge);
    if (ok === null) summary.skipped++;
    else {
      summary.retried++;
      if (ok) summary.recovered++;
    }
  }
  return summary;
}

/**
 * A member replaces their mock payment method (P0-6). If the subscription is past_due, the unpaid period
 * is retried at once with the new card. Returns the retry's outcome, or null when there was nothing to retry.
 */
export async function updateCard(actor: Actor, subscriptionId: string, card: 'approves' | 'declines', asOf: Date, charge: Charger = mockCharger) {
  await db.$transaction((t) => setCard(actor, subscriptionId, card, t));
  const [sub] = await loadPastDue({ id: subscriptionId, orgId: actor.orgId });
  return sub ? retry(actor, sub, calendarDay(asOf), charge) : null;
}
