import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { percentOfCents } from './money';
import { calendarDay, periodFrom } from './period';
import { InvalidTransition, type SubscriptionEvent } from './state';
import { advancePeriod, StaleTransition, transition } from './transition';

// P0-4: the daily billing run. Charges every trialing or active subscription whose nextBillingDate is on
// or before `asOf` (D-003), once per period. past_due belongs to dunning (P0-6); paused and
// pending_cancellation never renew (P0-7, P0-8). Pauses resume and cancellations end first, so a resumed
// subscription whose next billing date has come is charged in the same run, and a cancelled one is not.

export type ChargeResult = { ok: true; ref: string } | { ok: false; reason: string };
/** Charges a member. Must replay its first result for a repeated `idempotencyKey`, as Stripe does. */
export type Charger = (i: { subscriptionId: string; amountCents: number; idempotencyKey: string }) => Promise<ChargeResult>;

/** The mock provider: approves unless the subscription's mock card is set to decline (P0-6). */
export const mockCharger: Charger = async (i) => {
  const { card } = await db.subscription.findUniqueOrThrow({ where: { id: i.subscriptionId }, select: { card: true } });
  return card === 'approves' ? { ok: true, ref: `mock_${i.idempotencyKey}` } : { ok: false, reason: 'card_declined' };
};

const iso = (day: Date) => day.toISOString().slice(0, 10);

/** What a period's invoice charges: the plan price less a live coupon (P1-2), then less any downgrade credit (P0-5). */
export function invoiceFor(sub: { creditCents: number; couponOffBps: number; couponPeriodsLeft: number; plan: { priceCents: number } }) {
  const discountBps = sub.couponPeriodsLeft > 0 ? sub.couponOffBps : 0;
  const discountCents = percentOfCents(sub.plan.priceCents, discountBps);
  const creditAppliedCents = Math.min(sub.creditCents, sub.plan.priceCents - discountCents);
  return { amountCents: sub.plan.priceCents - discountCents - creditAppliedCents, creditAppliedCents, discountCents, discountBps };
}

/** Charges an invoice, or records it as paid by credit without calling the provider when nothing is owed. */
export const chargeInvoice = (charge: Charger, i: Parameters<Charger>[0]): Promise<ChargeResult> =>
  i.amountCents === 0 ? Promise.resolve({ ok: true, ref: 'credit' }) : charge(i);

/** Moves every subscription `where` matches through `event` as the system job, writing `also(row)` with it. A run that loses the race to another skips the row. */
async function sweep(day: Date, where: Prisma.SubscriptionWhereInput, event: SubscriptionEvent, also: (s: { pausedUntil: Date | null; currentPeriodEnd: Date }) => Parameters<typeof transition>[5]) {
  const rows = await db.subscription.findMany({ where, select: { id: true, orgId: true, pausedUntil: true, currentPeriodEnd: true } });
  for (const s of rows) {
    await transition({ orgId: s.orgId, userId: null }, s.id, event, day, undefined, also(s)).catch((e) => {
      if (!(e instanceof StaleTransition || e instanceof InvalidTransition)) throw e;
    });
  }
}

export async function runBilling(asOf: Date, charge: Charger = mockCharger) {
  const day = calendarDay(asOf);
  // A pause ending on or before `day` resumes (P0-7); a cancellation whose paid period has run out takes effect (P0-8).
  await sweep(day, { status: 'paused', pausedUntil: { lte: day } }, 'resume', (s) => ({ expect: { pausedUntil: s.pausedUntil }, set: { pausedUntil: null } }));
  await sweep(day, { status: 'pending_cancellation', currentPeriodEnd: { lte: day } }, 'period_ended', (s) => ({ expect: { currentPeriodEnd: s.currentPeriodEnd }, set: {} }));
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
    const invoice = invoiceFor(sub);
    const { amountCents, creditAppliedCents, discountCents } = invoice;
    // Charged before recording: if the write below never lands, a rerun sends the same key and the provider replays.
    const result = await chargeInvoice(charge, { subscriptionId: sub.id, amountCents, idempotencyKey: `${sub.id}:${iso(key.periodStart)}:1` });
    try {
      await db.$transaction(async (t) => {
        await t.chargeAttempt.create({
          data: {
            ...key,
            amountCents,
            creditAppliedCents,
            discountCents,
            outcome: result.ok ? 'succeeded' : 'failed',
            providerRef: result.ok ? result.ref : null,
            failureReason: result.ok ? null : result.reason,
            attemptedOn: day,
          },
        });
        const system = { orgId: sub.orgId, userId: null };
        if (!result.ok) return void (await transition(system, sub.id, 'payment_failed', day, t)); // opens dunning (P0-6)
        await advancePeriod(t, sub.id, periodFrom(sub.billingAnchor, sub.plan.interval, key.periodStart), invoice);
        if (sub.status === 'trialing') await transition(system, sub.id, 'convert', day, t);
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
