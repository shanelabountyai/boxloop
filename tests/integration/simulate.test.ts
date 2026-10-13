import { beforeEach, expect, it } from 'vitest';
import { db } from '@/core/db';
import { monthlyMetrics, trialConversionBps } from '@/subscriptions/metrics';
import { signup } from '@/subscriptions/signup';
import { passed, simulate } from '@/subscriptions/simulate';
import { seedDemo } from '../../scripts/seed-demo';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// D-009: the 180-day simulation meets the PRD's success metrics, and its numbers match a hand tally of the cohorts.
beforeEach(resetAuthTables);

it('runs 180 days with no duplicate charge, a reconciled ledger and the hand-tallied outcomes', async () => {
  await seedDemo(); // the demo operator, attached to `sim` below
  const r = await simulate();
  expect(passed(r)).toBe(true);
  expect(r.duplicateCharges).toEqual({ ledger: 0, provider: 0 });
  // 5 cards never fixed (cancelled on day 10), 5 fixed by the member, 5 soft declines recovered on the day-1 retry.
  expect(r.dunning).toEqual({ opened: 15, recovered: 10, cancelled: 5, recoveryRateBps: 6667 });
  expect(r.runs.dunning).toEqual({ retried: 25, recovered: 5, cancelled: 5, skipped: 0 }); // 5×3 + 5×1 + 5×1; member fixes are not the run's
  // Cancelled: 5 dunning, 5 trials, 3 of the 5 period-end cancels (2 undone).
  expect(r.statuses).toEqual({ active: 37, cancelled: 13 });
  // Jan 31: 13 converted trials ($335) + 3 Pro ($180) + 2 annual ($40/month).
  expect(r.mrr[0]).toEqual({ date: '2026-01-31', mrrCents: 55_500, paying: 18 });
  expect(r.mrr.map((m) => m.mrrCents)).toEqual([55_500, 115_000, 108_500, 105_000, 111_500, 111_500]);
  // P1-1 (D-010): the audit-stream replay agrees with every snapshot. 43 trials (all but Pro and annual): 5 cancelled on day +7, 38 converted.
  expect(r.eventsMatchState).toBe(true);
  const total = (k: 'trialsConverted' | 'trialsLost' | 'voluntaryChurn' | 'involuntaryChurn') => r.fromEvents.reduce((n, m) => n + m[k], 0);
  expect([total('trialsConverted'), total('trialsLost'), trialConversionBps(r.fromEvents)]).toEqual([38, 5, 8837]);
  expect([total('voluntaryChurn'), total('involuntaryChurn')]).toEqual([3, 5]); // 3 period-end cancels that stood; 5 cards never fixed
  // The dashboard's month ends, through the sim's last day, are the same rows.
  const { id } = await db.org.findUniqueOrThrow({ where: { slug: 'sim' } });
  expect(await monthlyMetrics(id, '2026-06-29')).toEqual(r.fromEvents);
  // ...and the demo operator can reach them from /demo.
  expect(await db.membership.findFirst({ where: { orgId: id, user: { email: 'owner@acme.demo.test' } }, select: { role: true } })).toEqual({ role: 'admin' });
}, 60_000);

it('refuses to run beside a real subscription, and leaves the previous run in place', async () => {
  const sim = await makeOrg('sim'); // the previous run's org
  const acme = await makeOrg('acme');
  const member = await addMember(acme.id, 'member', 'm@acme.test');
  const plan = await db.plan.create({ data: { orgId: acme.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays: 14 } });
  await signup({ orgId: acme.id, userId: member.id }, plan.id, new Date('2026-01-31T00:00:00Z'));

  await expect(simulate()).rejects.toThrow('1 subscriptions exist outside the sim');
  expect(await db.org.findUnique({ where: { id: sim.id } })).not.toBeNull();
});
