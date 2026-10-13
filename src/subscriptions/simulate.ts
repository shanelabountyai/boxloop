import { db } from '@/core/db';
import type { Subscription } from '@/generated/prisma/client';
import { type Charger, mockCharger, runBilling } from './billing-run';
import { undoCancel } from './cancel';
import { runDunning, updateCard } from './dunning';
import { type MetricsRow, metricsOn, monthlyCents, MRR_STATUSES, trialConversionBps } from './metrics';
import { formatBps, formatCents, ratioBps } from './money';
import { pause } from './pause';
import { addDays, calendarDay, iso } from './period';
import { changePlan } from './plan-change';
import { signup } from './signup';
import { transition } from './transition';

// The 180-day simulation (PRD Success Metrics, D-009). Seeds the `sim` org with 50 members, then walks a virtual
// clock one day at a time: billing and dunning each run twice (the second run must change nothing), then each
// member does what their cohort scripts for that day. Deterministic, so every number it prints can be hand-tallied.

export const SIM_ORG = 'sim';
const SIM_EMAIL = '@sim.boxloop.test';
const SIM_OPERATOR = 'owner@acme.demo.test';
const MEMBERS = 50;

const PLANS = {
  basic: { name: 'Basic box', priceCents: 2000, interval: 'month', trialDays: 14 },
  plus: { name: 'Plus box', priceCents: 3500, interval: 'month', trialDays: 14 },
  pro: { name: 'Pro box', priceCents: 6000, interval: 'month', trialDays: 0 },
  annual: { name: 'Annual box', priceCents: 24000, interval: 'year', trialDays: 0 },
} as const;
type PlanKey = keyof typeof PLANS;

type Member = { i: number; cohort: number; plan: PlanKey; signupDay: Date; actor: { orgId: string; userId: string }; subId?: string };
type Ctx = { day: Date; sub: Subscription; plans: Record<PlanKey, string>; charge: Charger };

/** What member `i` does, by `i % 10`. Offsets are days after signup; every action runs after that day's billing and dunning. */
const COHORTS: { label: string; plan: (i: number) => PlanKey; act?: (m: Member, c: Ctx) => unknown }[] = [
  { label: 'steady (half on the annual plan)', plan: (i) => (i % 20 === 10 ? 'annual' : 'basic') },
  { label: 'steady', plan: () => 'plus' },
  { label: 'upgrades Basic → Plus on day +40', plan: () => 'basic', act: (m, c) => on(m, c, 40) && changePlan(m.actor, c.sub.id, c.plans.plus, c.day, c.charge) },
  { label: 'downgrades Pro → Plus on day +50', plan: () => 'pro', act: (m, c) => on(m, c, 50) && changePlan(m.actor, c.sub.id, c.plans.plus, c.day, c.charge) },
  { label: 'card declines from day +45, never fixed', plan: () => 'basic', act: (m, c) => on(m, c, 45) && updateCard(m.actor, c.sub.id, 'declines', c.day, c.charge) },
  {
    label: 'card declines from day +45, fixed 2 days into dunning',
    plan: () => 'plus',
    act: (m, c) =>
      on(m, c, 45) ? updateCard(m.actor, c.sub.id, 'declines', c.day, c.charge)
      : c.sub.status === 'past_due' && +c.day === +addDays(c.sub.nextBillingDate, 2) ? updateCard(m.actor, c.sub.id, 'approves', c.day, c.charge)
      : undefined,
  },
  { label: 'first renewal from day +45 soft-declines once (dunning day-1 retry recovers)', plan: () => 'basic' },
  { label: 'pauses 2 periods on day +35', plan: () => 'plus', act: (m, c) => on(m, c, 35) && pause(m.actor, c.sub.id, 2, c.day) },
  {
    label: 'cancels on day +50 (half undo on day +55)',
    plan: () => 'basic',
    act: (m, c) => (on(m, c, 50) ? transition(m.actor, c.sub.id, 'cancel', c.day) : m.i % 20 === 18 && on(m, c, 55) ? undoCancel(m.actor, c.sub.id, c.day) : undefined),
  },
  { label: 'cancels the trial on day +7', plan: () => 'plus', act: (m, c) => on(m, c, 7) && transition(m.actor, c.sub.id, 'cancel', c.day) },
];
const SOFT_DECLINE_COHORT = 6;

const on = (m: Member, c: Ctx, offset: number) => +c.day === +addDays(m.signupDay, offset);

/** Deletes the previous run's org and members. Audit rows stay (append-only, INV-19). */
async function reset() {
  // Check before deleting: a refusal must leave the previous run's org in place, not half-reset.
  const others = await db.subscription.count({ where: { org: { slug: { not: SIM_ORG } } } });
  // ponytail: the billing run is global, so the sim needs the subscriptions table to itself; a per-org run would lift this.
  if (others > 0) throw new Error(`${others} subscriptions exist outside the sim; the simulated billing run would charge them too`);
  await db.org.deleteMany({ where: { slug: SIM_ORG } });
  await db.user.deleteMany({ where: { email: { endsWith: SIM_EMAIL } } });
}

export async function simulate({ start = new Date('2026-01-01T00:00:00Z'), days = 180 } = {}) {
  await reset();
  start = calendarDay(start);
  const org = await db.org.create({ data: { slug: SIM_ORG, name: 'BoxLoop simulation' } });
  const plans = {} as Record<PlanKey, string>;
  for (const [k, p] of Object.entries(PLANS)) plans[k as PlanKey] = (await db.plan.create({ data: { orgId: org.id, ...p } })).id;
  // The demo operator: seed:demo's Acme owner, made admin here so /o/sim/metrics is reachable from /demo.
  const operator = await db.user.findFirst({ where: { email: SIM_OPERATOR, isDemo: true } });
  if (operator) await db.membership.create({ data: { orgId: org.id, userId: operator.id, role: 'admin' } });

  const members: Member[] = [];
  for (let i = 0; i < MEMBERS; i++) {
    const user = await db.user.create({ data: { email: `member-${String(i).padStart(2, '0')}${SIM_EMAIL}`, name: `Member ${i}` } });
    await db.membership.create({ data: { orgId: org.id, userId: user.id, role: 'member' } });
    const cohort = i % COHORTS.length;
    members.push({ i, cohort, plan: COHORTS[cohort]!.plan(i), signupDay: addDays(start, i), actor: { orgId: org.id, userId: user.id } });
  }

  // The provider: the mock card, plus one scripted soft decline per soft-decline member, and a log of every successful charge.
  const charged = new Map<string, { times: number; amountCents: number }>();
  const softDeclined = new Set<string>();
  const charge: Charger = async (i) => {
    const m = members.find((x) => x.subId === i.subscriptionId); // none yet for a signup's first charge
    const renewal = /:(\d{4}-\d{2}-\d{2}):1$/.exec(i.idempotencyKey);
    if (m?.cohort === SOFT_DECLINE_COHORT && renewal && new Date(`${renewal[1]}T00:00:00Z`) >= addDays(m.signupDay, 45) && !softDeclined.has(m.subId!)) {
      softDeclined.add(m.subId!);
      return { ok: false, reason: 'insufficient_funds' };
    }
    const r = await mockCharger(i);
    if (r.ok) charged.set(i.idempotencyKey, { times: (charged.get(i.idempotencyKey)?.times ?? 0) + 1, amountCents: i.amountCents });
    return r;
  };

  const runs = { billing: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, dunning: { retried: 0, recovered: 0, cancelled: 0, skipped: 0 }, rerunChanges: 0 };
  const add = <T extends Record<string, number>>(into: T, r: T) => Object.keys(r).forEach((k) => ((into as Record<string, number>)[k]! += r[k]!));
  const mrr: { date: string; mrrCents: number; paying: number }[] = [];

  for (let d = 0; d < days; d++) {
    const day = addDays(start, d);
    for (const m of members) if (+m.signupDay === +day) m.subId = (await signup(m.actor, plans[m.plan], day, charge)).id; // a no-trial plan is charged by signup itself (D-015)
    add(runs.billing, await runBilling(day, charge));
    const again = await runBilling(day, charge); // idempotency: a second run the same day charges nothing
    runs.rerunChanges += again.attempted;
    add(runs.dunning, await runDunning(day, charge));
    runs.rerunChanges += (await runDunning(day, charge)).retried;

    for (const m of members) {
      if (!m.subId || +m.signupDay === +day) continue;
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: m.subId } });
      await COHORTS[m.cohort]!.act?.(m, { day, sub, plans, charge });
    }

    if (addDays(day, 1).getUTCDate() === 1 || d === days - 1) mrr.push({ date: iso(day), ...(await mrrOn(org.id)) });
  }
  // P1-1 (D-010): the same month ends replayed from the audit stream must match the snapshots taken from the rows.
  const fromEvents = await metricsOn(org.id, mrr.map((m) => m.date));
  const eventsMatchState = fromEvents.every((e, i) => e.mrrCents === mrr[i]!.mrrCents && e.paying === mrr[i]!.paying);
  return { start: iso(start), end: iso(addDays(start, days - 1)), members: MEMBERS, runs, mrr, fromEvents, eventsMatchState, ...(await reconcile(org.id, charged)), cohorts: COHORTS.map((c) => c.label) };
}

/** Monthly recurring revenue right now: each paying subscription's price per month (a yearly price / 12). */
async function mrrOn(orgId: string) {
  const subs = await db.subscription.findMany({ where: { orgId }, include: { plan: true, _count: { select: { chargeAttempts: { where: { outcome: 'succeeded' } } } } } });
  const paying = subs.filter((s) => MRR_STATUSES.has(s.status) && s._count.chargeAttempts > 0); // ever paid (D-016)
  const mrrCents = paying.reduce((sum, s) => sum + monthlyCents(s.plan), 0);
  return { mrrCents, paying: paying.length };
}

/** Duplicate charges, the provider log against the ledger, and dunning outcomes, all read back from the database. */
async function reconcile(orgId: string, charged: Map<string, { times: number; amountCents: number }>) {
  const attempts = await db.chargeAttempt.findMany({ where: { subscription: { orgId } } });
  const changes = await db.planChange.findMany({ where: { subscription: { orgId } } });
  const period = (a: { subscriptionId: string; periodStart: Date }) => `${a.subscriptionId}:${iso(a.periodStart)}`;

  const paidPeriods = attempts.filter((a) => a.outcome === 'succeeded').map(period);
  const ledgerDuplicates = paidPeriods.length - new Set(paidPeriods).size;
  const providerDuplicates = [...charged.values()].filter((c) => c.times > 1).length;
  const providerCents = [...charged.values()].reduce((s, c) => s + c.amountCents * c.times, 0);
  const ledgerCents =
    attempts.filter((a) => a.outcome === 'succeeded' && a.providerRef !== 'credit').reduce((s, a) => s + a.amountCents, 0) +
    changes.filter((c) => c.providerRef).reduce((s, c) => s + c.netCents, 0);

  const opened = attempts.filter((a) => a.attempt === 1 && a.outcome === 'failed').map(period);
  const recovered = opened.filter((p) => paidPeriods.includes(p)).length;
  const exhausted = await db.auditEvent.count({ where: { orgId, action: 'subscription.dunning_exhausted' } });
  const statuses = await db.subscription.groupBy({ by: ['status'], where: { orgId }, _count: true, orderBy: { status: 'asc' } });
  return {
    duplicateCharges: { ledger: ledgerDuplicates, provider: providerDuplicates },
    collected: { providerCents, ledgerCents, reconciled: providerCents === ledgerCents },
    dunning: { opened: opened.length, recovered, cancelled: exhausted, recoveryRateBps: ratioBps(recovered, opened.length) },
    statuses: Object.fromEntries(statuses.map((s) => [s.status, s._count])),
  };
}

/** The summary as printed by `npm run simulate`. */
export function report(r: Awaited<ReturnType<typeof simulate>>) {
  return [
    `BoxLoop simulation: ${r.members} members, ${r.start} → ${r.end}`,
    '',
    'Cohorts (member i is cohort i % 10):',
    ...r.cohorts.map((c, i) => `  ${i}  ${c}`),
    '',
    `Billing runs:  ${r.runs.billing.attempted} charges (${r.runs.billing.succeeded} ok, ${r.runs.billing.failed} failed)`,
    `Dunning runs:  ${r.runs.dunning.retried} retries, ${r.runs.dunning.recovered} recovered, ${r.runs.dunning.cancelled} cancelled`,
    `Same-day reruns that charged anything: ${r.runs.rerunChanges}`,
    '',
    `Duplicate charges:  ${r.duplicateCharges.ledger} in the ledger, ${r.duplicateCharges.provider} at the provider`,
    `Collected:          ${formatCents(r.collected.ledgerCents)} recorded, ${formatCents(r.collected.providerCents)} charged — ${r.collected.reconciled ? 'reconciled' : 'MISMATCH'}`,
    `Dunning recovery:   ${r.dunning.recovered} of ${r.dunning.opened} failed renewals recovered (${formatBps(r.dunning.recoveryRateBps)}), ${r.dunning.cancelled} cancelled`,
    '',
    'MRR by month end:',
    ...r.mrr.map((m) => `  ${m.date}  ${formatCents(m.mrrCents).padStart(9)}  (${m.paying} paying)`),
    '',
    `From the audit stream: MRR and paying ${r.eventsMatchState ? 'match' : 'DO NOT MATCH'} the snapshots above; trial conversion ${formatBps(trialConversionBps(r.fromEvents))}`,
    '              trials won/lost   churn voluntary/involuntary',
    ...r.fromEvents.map((m: MetricsRow) => `  ${m.date}       ${String(m.trialsConverted).padStart(2)} / ${m.trialsLost}                 ${m.voluntaryChurn} / ${m.involuntaryChurn}`),
    '',
    `Final statuses: ${Object.entries(r.statuses).map(([s, n]) => `${s} ${n}`).join(', ')}`,
  ].join('\n');
}

/** False when the run broke a success metric; the command exits non-zero. */
export const passed = (r: Awaited<ReturnType<typeof simulate>>) =>
  r.duplicateCharges.ledger === 0 && r.duplicateCharges.provider === 0 && r.runs.rerunChanges === 0 && r.collected.reconciled && r.eventsMatchState;
