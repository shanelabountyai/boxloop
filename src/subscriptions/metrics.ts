import { db } from '@/core/db';

// P1-1: business metrics derived from the `subscription.*` audit stream, not from the current rows (D-010). Each event
// carries its business day `on` and the state it moved to; `created` also names the plan, `plan_changed` the new one.
// Plan prices never change (D-001), so a plan id is enough to price a subscription at any point in its history.

/** Paying or still owed, for a member who has paid at least once (D-016): a failed trial conversion in dunning is not revenue, nor are trials and pauses. */
export const MRR_STATUSES = new Set(['active', 'past_due', 'pending_cancellation']);

type Plan = { id: string; priceCents: number; interval: 'month' | 'year' };
export type SubEvent = { targetId: string; action: string; data: { on: string; to: string; planId?: string } };
export type MetricsRow = {
  date: string;
  mrrCents: number;
  paying: number;
  trialing: number;
  // Since the previous row's date:
  trialsConverted: number;
  trialsLost: number; // cancelled before ever paying
  voluntaryChurn: number; // a paying member's cancellation took effect
  involuntaryChurn: number; // dunning gave up on a paying member (D-005)
};

/** A plan's price per month. ponytail: a yearly price rounds half-up to the cent; MRR can drift a cent per annual member. */
export const monthlyCents = (p: Plan) => (p.interval === 'year' ? Math.floor((p.priceCents + 6) / 12) : p.priceCents);

/** Folds `events` into one row per date in `dates` (ascending): the state at the end of that day, and what happened since the previous row. */
export function replay(events: SubEvent[], plans: Map<string, Plan>, dates: string[]): MetricsRow[] {
  const missing = events.find((e) => !e.data?.on);
  if (missing) throw new Error(`subscription ${missing.targetId}: ${missing.action} has no business day`); // it would stall the fold below
  const sorted = [...events].sort((a, b) => (a.data.on < b.data.on ? -1 : a.data.on > b.data.on ? 1 : 0)); // stable: same-day events keep their write order
  const subs = new Map<string, { status: string; planId: string; everPaid: boolean }>();
  let i = 0;
  return dates.map((date) => {
    const row: MetricsRow = { date, mrrCents: 0, paying: 0, trialing: 0, trialsConverted: 0, trialsLost: 0, voluntaryChurn: 0, involuntaryChurn: 0 };
    for (; i < sorted.length && sorted[i]!.data.on <= date; i++) {
      const { targetId, action, data } = sorted[i]!;
      if (action === 'subscription.created') {
        if (!data.planId) throw new Error(`subscription ${targetId}: created event names no plan`);
        subs.set(targetId, { status: data.to, planId: data.planId, everPaid: data.to !== 'trialing' });
        continue;
      }
      const s = subs.get(targetId);
      if (!s) throw new Error(`subscription ${targetId}: ${action} before its created event`);
      if (action === 'subscription.plan_changed') s.planId = data.to;
      if (action === 'subscription.plan_changed' || action === 'subscription.card_updated' || action === 'subscription.coupon_applied') continue;
      s.status = data.to;
      if (s.status === 'active' && !s.everPaid) {
        s.everPaid = true;
        row.trialsConverted++; // a straight convert, or a failed conversion recovered in dunning
      }
      if (s.status === 'cancelled') row[!s.everPaid ? 'trialsLost' : action === 'subscription.dunning_exhausted' ? 'involuntaryChurn' : 'voluntaryChurn']++;
    }
    for (const s of subs.values()) {
      if (MRR_STATUSES.has(s.status) && s.everPaid) {
        row.paying++;
        row.mrrCents += monthlyCents(plans.get(s.planId)!);
      } else if (s.status === 'trialing') row.trialing++;
    }
    return row;
  });
}

/** Converted trials as basis points of trials that have ended either way, rounded half-up. */
export const trialConversionBps = (rows: MetricsRow[]) => {
  const won = rows.reduce((n, r) => n + r.trialsConverted, 0);
  const ended = won + rows.reduce((n, r) => n + r.trialsLost, 0);
  return ended ? Math.floor((won * 20_000 + ended) / (2 * ended)) : 0;
};

/** The org's metrics on each of `dates` (YYYY-MM-DD, ascending), read from its audit stream. */
export async function metricsOn(orgId: string, dates: string[]) {
  const [events, plans] = await Promise.all([
    db.auditEvent.findMany({ where: { orgId, action: { startsWith: 'subscription.' } }, orderBy: { id: 'asc' }, select: { targetId: true, action: true, data: true } }),
    db.plan.findMany({ where: { orgId }, select: { id: true, priceCents: true, interval: true } }),
  ]);
  return replay(events as SubEvent[], new Map(plans.map((p) => [p.id, p])), dates);
}

/** Month ends from the month of the org's first subscription event through `through`'s month; the last row is `through` itself. */
export async function monthlyMetrics(orgId: string, through: string) {
  const first = await db.auditEvent.findFirst({ where: { orgId, action: 'subscription.created' }, orderBy: { id: 'asc' }, select: { data: true } });
  if (!first) return [];
  const dates: string[] = [];
  for (let [y, m] = (first.data as SubEvent['data']).on.split('-').map(Number) as [number, number]; ; m++) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of the next month
    if (end >= through) break;
    dates.push(end);
  }
  return metricsOn(orgId, [...dates, through]);
}
