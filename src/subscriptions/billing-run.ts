import { db } from '@/core/db';
import { calendarDay, periodFrom } from './period';
import { advancePeriod, StaleTransition, transition } from './transition';

// P0-4: the daily billing run. Charges every trialing or active subscription whose nextBillingDate is on
// or before `asOf` (D-003), once per period. past_due belongs to dunning (P0-6); paused and
// pending_cancellation never renew (P0-7, P0-8).

export type ChargeResult = { ok: true; ref: string } | { ok: false; reason: string };
/** Charges a member. Must replay its first result for a repeated `idempotencyKey`, as Stripe does. */
export type Charger = (i: { subscriptionId: string; amountCents: number; idempotencyKey: string }) => Promise<ChargeResult>;

/** The mock provider: approves unless the subscription's mock card is set to decline (P0-6). */
export const mockCharger: Charger = async (i) => {
  const { card } = await db.subscription.findUniqueOrThrow({ where: { id: i.subscriptionId }, select: { card: true } });
  return card === 'approves' ? { ok: true, ref: `mock_${i.idempotencyKey}` } : { ok: false, reason: 'card_declined' };
};

const iso = (day: Date) => day.toISOString().slice(0, 10);

/** What a period's invoice charges: the plan price less any downgrade credit (P0-5). */
export function invoiceFor(sub: { creditCents: number; plan: { priceCents: number } }) {
  const creditAppliedCents = Math.min(sub.creditCents, sub.plan.priceCents);
  return { amountCents: sub.plan.priceCents - creditAppliedCents, creditAppliedCents };
}

/** Charges an invoice, or records it as paid by credit without calling the provider when nothing is owed. */
export const chargeInvoice = (charge: Charger, i: Parameters<Charger>[0]): Promise<ChargeResult> =>
  i.amountCents === 0 ? Promise.resolve({ ok: true, ref: 'credit' }) : charge(i);

export async function runBilling(asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  const due = await db.subscription.findMany({
    where: { status: { in: ['trialing', 'active'] }, nextBillingDate: { lte: day } },
    include: { plan: { select: { priceCents: true, interval: true } } },
    orderBy: { id: 'asc' },
  });
  const summary = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  // ponytail: one period per subscription per run, and an unexpected error stops the run; a rerun resumes, idempotently.
  for (const sub of due) {
    const key = { subscriptionId: sub.id, periodStart: sub.nextBillingDate, attempt: 1 };
    if (await db.chargeAttempt.findUnique({ where: { subscriptionId_periodStart_attempt: key } })) {
      summary.skipped++;
      continue;
    }
    const { amountCents, creditAppliedCents } = invoiceFor(sub);
    // Charged before recording: if the write below never lands, a rerun sends the same key and the provider replays.
    const result = await chargeInvoice(charge, { subscriptionId: sub.id, amountCents, idempotencyKey: `${sub.id}:${iso(key.periodStart)}:1` });
    try {
      await db.$transaction(async (t) => {
        await t.chargeAttempt.create({
          data: {
            ...key,
            amountCents,
            creditAppliedCents,
            outcome: result.ok ? 'succeeded' : 'failed',
            providerRef: result.ok ? result.ref : null,
            failureReason: result.ok ? null : result.reason,
            attemptedOn: day,
          },
        });
        const system = { orgId: sub.orgId, userId: null };
        if (!result.ok) return void (await transition(system, sub.id, 'payment_failed', t)); // opens dunning (P0-6)
        await advancePeriod(t, sub.id, periodFrom(sub.billingAnchor, sub.plan.interval, key.periodStart), creditAppliedCents);
        if (sub.status === 'trialing') await transition(system, sub.id, 'convert', t);
      });
    } catch (e) {
      // Another run recorded this period, or moved the subscription, after our read.
      if ((e as { code?: string }).code !== 'P2002' && !(e instanceof StaleTransition)) throw e;
      summary.skipped++;
      continue;
    }
    summary.attempted++;
    summary[result.ok ? 'succeeded' : 'failed']++;
  }
  return summary;
}
