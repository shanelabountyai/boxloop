import { db } from '@/core/db';
import type { ChargeAttempt, Plan, PlanChange, Subscription } from '@/generated/prisma/client';
import { invoiceFor } from '@/subscriptions/billing-run';
import { dunningOutlook, sequence } from '@/subscriptions/dunning';
import { formatCents } from '@/subscriptions/money';
import { formatDay } from '@/subscriptions/period';
import type { SubscriptionStatus } from '@/subscriptions/state';

// The subscription card, pill and history shared by the member page and the operator pages (design board §2, §3).
// Each status has a colour family, an icon and a word, so status is never colour alone.

export type FullSub = Subscription & { plan: Plan; chargeAttempts: ChargeAttempt[]; planChanges: PlanChange[] };
export const fullSub = { plan: true, chargeAttempts: { orderBy: { attempt: 'asc' } }, planChanges: { orderBy: { seq: 'asc' } } } as const;

/** How a cancelled subscription ended, read from its audit events: the day, and whether dunning ended it. */
export type Ending = { on: Date; dunning: boolean; trial: boolean };

const PILL: Record<SubscriptionStatus, [label: string, icon: string, family: string]> = {
  trialing: ['Trial', '◔', 'trial'],
  active: ['Active', '●', 'good'],
  past_due: ['Past due', '▲', 'risk'],
  paused: ['Paused', '❚❚', 'hold'],
  pending_cancellation: ['Ending', '◐', 'end'],
  cancelled: ['Cancelled', '○', 'done'],
};

export const statusLabel = (s: SubscriptionStatus) => PILL[s][0];
export const statusFamily = (s: SubscriptionStatus) => PILL[s][2];

export function StatusPill({ status }: { status: SubscriptionStatus }) {
  const [label, icon, k] = PILL[status];
  return (
    <span className="pill" data-k={k}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

export async function endings(subscriptionIds: string[]): Promise<Map<string, Ending>> {
  const events = await db.auditEvent.findMany({
    where: { targetType: 'subscription', targetId: { in: subscriptionIds }, action: { in: ['subscription.cancel', 'subscription.period_ended', 'subscription.dunning_exhausted'] } },
  });
  const out = new Map<string, Ending>();
  for (const e of events) {
    const d = e.data as { to?: string; from?: string; on?: string } | null;
    if (d?.to !== 'cancelled' || !d.on) continue;
    out.set(e.targetId!, { on: new Date(d.on), dunning: e.action === 'subscription.dunning_exhausted', trial: d.from === 'trialing' });
  }
  return out;
}

/** The dates line (the largest text on the card) and the paid-through line, for the state the subscription is in. */
export function summary(sub: FullSub, today: Date, ending?: Ending): { dates: string; paid: string } {
  const d = (x: Date) => formatDay(x, today);
  const inv = invoiceFor(sub);
  const off = [inv.discountCents && `${formatCents(inv.discountCents)} discount`, inv.creditAppliedCents && `${formatCents(inv.creditAppliedCents)} credit`].filter(Boolean).join(' and ');
  const amount = `${formatCents(inv.amountCents)}${off ? ` after ${off}` : ''}`;
  const paidThrough = (x: Date) => `Paid through ${d(x)}`;
  switch (sub.status) {
    case 'trialing':
      return { dates: `Trial ends ${d(sub.nextBillingDate)}, then ${formatCents(inv.amountCents)}/${sub.plan.interval}`, paid: 'No charge yet' };
    case 'active':
      return { dates: `Renews ${d(sub.nextBillingDate)} for ${amount}`, paid: paidThrough(sub.currentPeriodEnd) };
    case 'past_due': {
      const seq = sequence(sub);
      if (!seq) return { dates: 'Payment failed.', paid: paidThrough(sub.nextBillingDate) };
      const o = dunningOutlook(seq);
      const retry = o.retry ? `Retry ${o.retry.n} of ${o.retry.of} on ${d(o.retry.on)}.` : 'No retries left.';
      return { dates: `Payment failed ${d(o.failedOn)}. ${retry} Cancels ${d(o.cancelsOn)} if unpaid.`, paid: paidThrough(sub.nextBillingDate) };
    }
    case 'paused':
      return { dates: `Paused until ${d(sub.pausedUntil!)}. Next charge ${d(sub.nextBillingDate)}.`, paid: 'Your unused paid days continue after the pause' };
    case 'pending_cancellation':
      return { dates: `Ends ${d(sub.currentPeriodEnd)}. Nothing more will be charged.`, paid: paidThrough(sub.currentPeriodEnd) };
    case 'cancelled':
      if (!ending) return { dates: 'Ended', paid: '' };
      if (ending.dunning) return { dates: `Ended ${d(ending.on)}, payment not recovered`, paid: 'Cancelled after the retries failed' };
      return { dates: `Ended ${d(ending.on)}`, paid: ending.trial ? 'Trial cancelled, nothing was charged' : 'Cancelled by member' };
  }
}

export function SubCard({ sub, today, ending, readonly, children }: { sub: FullSub; today: Date; ending?: Ending; readonly?: boolean; children?: React.ReactNode }) {
  const { dates, paid } = summary(sub, today, ending);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{sub.plan.name}</h2>
        <p className="price">
          {formatCents(sub.plan.priceCents)}
          <span>/{sub.plan.interval}</span>
        </p>
      </div>
      <div>
        <StatusPill status={sub.status} />
      </div>
      <p className="dates">{dates}</p>
      {paid && <p className="muted">{paid}</p>}
      {readonly ? <p className="card-foot muted">Read-only view. Operators cannot change a member&apos;s subscription.</p> : children && <div className="card-foot actions">{children}</div>}
    </section>
  );
}

type Row = { key: string; on: Date; total: number; chip: [family: string, icon: string, text: string]; lines: [string, number][] };

/** Billing history, newest first: one row per charge attempt and per plan change, with line items. */
export function historyRows(sub: FullSub, planNames: Map<string, string>, today: Date): Row[] {
  const name = (id: string) => planNames.get(id) ?? 'Plan';
  const charges = sub.chargeAttempts.map((a): Row => {
    const gross = a.amountCents + a.creditAppliedCents + a.discountCents;
    const lines: [string, number][] = [[`Billing period from ${formatDay(a.periodStart, today)}`, gross]];
    if (a.discountCents) lines.push(['Discount', -a.discountCents]);
    if (a.creditAppliedCents) lines.push(['Credit applied', -a.creditAppliedCents]);
    const reason = a.failureReason?.replace(/_/g, ' ');
    const chip: Row['chip'] =
      a.outcome === 'failed' ? ['risk', '✕', `Failed${reason ? ` · ${reason}` : ''}${a.attempt > 1 ? ` · retry ${a.attempt - 1}` : ''}`]
      : a.providerRef === 'credit' ? ['hold', '↺', 'Paid by credit']
      : ['good', '✓', 'Succeeded'];
    return { key: a.id, on: a.attemptedOn, total: a.amountCents, chip, lines };
  });
  const changes = sub.planChanges.map((c): Row => ({
    key: c.id,
    on: c.effectiveOn,
    total: Math.max(0, c.netCents),
    chip: c.netCents > 0 ? ['good', '✓', `Changed to ${name(c.toPlanId)}`] : c.netCents < 0 ? ['hold', '↺', 'Credit to next invoice'] : ['trial', '◔', `Changed to ${name(c.toPlanId)}, no charge`],
    lines: c.remainingDays && (c.creditCents || c.chargeCents)
      ? [[`Credit for unused ${name(c.fromPlanId)}, ${c.remainingDays} days`, c.creditCents], [`${name(c.toPlanId)} for the rest of the period, ${c.remainingDays} days`, c.chargeCents]]
      : [],
  }));
  return [...charges, ...changes].sort((a, b) => b.on.getTime() - a.on.getTime());
}

export function History({ rows, today, empty }: { rows: Row[]; today: Date; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="rows">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="row-head">
            <span>
              <strong className="day">{formatDay(r.on, today)}</strong>
              <span className="chip" data-k={r.chip[0]}>
                <span aria-hidden="true">{r.chip[1]}</span>
                {r.chip[2]}
              </span>
            </span>
            <strong className="num">{formatCents(r.total)}</strong>
          </div>
          {r.lines.map(([d, a]) => (
            <div key={d} className="line">
              <span>{d}</span>
              <span>{formatCents(a)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Every plan name in the org, for history lines that name a plan the subscription has since left. */
export const planNames = async (orgId: string) => new Map((await db.plan.findMany({ where: { orgId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));

/** A member's newest subscription in the org, the one their page shows and their actions change. */
export const mySubscription = (ctx: { orgId: string; userId: string }) =>
  db.subscription.findFirst({ where: { orgId: ctx.orgId, userId: ctx.userId }, orderBy: { createdAt: 'desc' }, include: fullSub });
