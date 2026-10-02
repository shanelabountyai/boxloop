import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, mockCharger, runBilling } from '@/subscriptions/billing-run';
import { pause } from '@/subscriptions/pause';
import { addDays } from '@/subscriptions/period';
import { signup } from '@/subscriptions/signup';
import { InvalidTransition } from '@/subscriptions/state';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-7: a pause skips whole billing periods, charges nothing while paused, and resumes on its own.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date | null) => date && date.toISOString().slice(0, 10);
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });

/** A $30/month member who signed up (and, without a trial, paid the first period) on `on`. */
async function subscribed(on: string, trialDays = 0) {
  const org = await makeOrg('acme');
  const member = await addMember(org.id, 'member', 'm@acme.test');
  const plan = await db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays } });
  const actor = { orgId: org.id, userId: member.id };
  const sub = await signup(actor, plan.id, day(on));
  await runBilling(day(on));
  return { sub, actor };
}

/** Runs billing every day from `from` to `to` inclusive, recording each charge's period start. */
async function daily(from: string, to: string) {
  const charged: string[] = [];
  const charge: Charger = (i) => (charged.push(i.idempotencyKey.split(':')[1]!), mockCharger(i));
  for (let d = day(from); d <= day(to); d = addDays(d, 1)) await runBilling(d, charge);
  return charged;
}

describe('pause', () => {
  it('paused for 2 months, the next billing date is exactly 2 months later and nothing is charged meanwhile', async () => {
    const { sub, actor } = await subscribed('2026-01-15'); // paid Jan 15 – Feb 15; would next bill Feb 15
    await pause(actor, sub.id, 2, day('2026-02-01'));

    const paused = await row(sub.id);
    expect(paused).toMatchObject({ status: 'paused', billingAnchor: day('2026-01-15') });
    expect([paused.pausedUntil, paused.currentPeriodStart, paused.currentPeriodEnd, paused.nextBillingDate].map(iso)).toEqual([
      '2026-04-01',
      '2026-03-15',
      '2026-04-15', // the 14 unused paid days (Feb 1–15) now run Apr 1–15
      '2026-04-15',
    ]);

    expect(await daily('2026-02-01', '2026-03-31')).toEqual([]);
    expect((await row(sub.id)).status).toBe('paused');
    expect(await daily('2026-04-01', '2026-05-15')).toEqual(['2026-04-15', '2026-05-15']);
    expect(await row(sub.id)).toMatchObject({ status: 'active', pausedUntil: null });

    const actions = await db.auditEvent.findMany({ where: { targetId: sub.id, action: { in: ['subscription.pause', 'subscription.resume'] } }, orderBy: { id: 'asc' } });
    expect(actions.map((a) => [a.action, a.actorUserId, (a.data as { pausedUntil?: string }).pausedUntil])).toEqual([
      ['subscription.pause', actor.userId, '2026-04-01'],
      ['subscription.resume', null, null],
    ]);
  });

  it('keeps a 31st anchor on the 31st through the pause', async () => {
    const { sub, actor } = await subscribed('2026-01-31'); // would next bill Feb 28
    await pause(actor, sub.id, 1, day('2026-02-10'));
    expect(iso((await row(sub.id)).nextBillingDate)).toBe('2026-03-31');
    expect(await daily('2026-02-10', '2026-05-31')).toEqual(['2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('a resume day that is also the billing day resumes and charges once, however often the run repeats', async () => {
    const { sub, actor } = await subscribed('2026-01-15');
    await pause(actor, sub.id, 1, day('2026-01-15')); // whole paid period unused: resumes Feb 15, bills Mar 15
    expect(await daily('2026-02-15', '2026-02-15')).toEqual([]);
    expect((await row(sub.id)).status).toBe('active');
    expect(await daily('2026-03-15', '2026-03-15')).toEqual(['2026-03-15']);
    expect(await daily('2026-03-15', '2026-03-15')).toEqual([]);
    expect(await db.auditEvent.count({ where: { targetId: sub.id, action: 'subscription.resume' } })).toBe(1);
  });

  it('refuses a trial, a length outside 1–3, and a second pause, writing nothing', async () => {
    const trial = await subscribed('2026-01-15', 14);
    await expect(pause(trial.actor, trial.sub.id, 1, day('2026-01-20'))).rejects.toBeInstanceOf(InvalidTransition);
    expect(await row(trial.sub.id)).toMatchObject({ status: 'trialing', pausedUntil: null });

    await resetAuthTables();
    const { sub, actor } = await subscribed('2026-01-15');
    await expect(pause(actor, sub.id, 0, day('2026-01-20'))).rejects.toThrow('1 to 3');
    await expect(pause(actor, sub.id, 4, day('2026-01-20'))).rejects.toThrow('1 to 3');
    await pause(actor, sub.id, 1, day('2026-01-20'));
    await expect(pause(actor, sub.id, 1, day('2026-01-21'))).rejects.toBeInstanceOf(InvalidTransition);
    expect(await db.auditEvent.count({ where: { targetId: sub.id, action: 'subscription.pause' } })).toBe(1);
  });

  it('on a yearly plan one period is a year (D-019)', async () => {
    const org = await makeOrg('acme');
    const member = await addMember(org.id, 'member', 'm@acme.test');
    const actor = { orgId: org.id, userId: member.id };
    const plan = await db.plan.create({ data: { orgId: org.id, name: 'Year', priceCents: 30000, interval: 'year', trialDays: 0 } });
    const sub = await signup(actor, plan.id, day('2026-01-15')); // paid to 2027-01-15
    const set = await pause(actor, sub.id, 1, day('2026-12-15')); // 31 days unused
    expect([set.pausedUntil, set.nextBillingDate].map(iso)).toEqual(['2027-12-15', '2028-01-15']);
  });

  it('the database refuses a paused row without an end date', async () => {
    const { sub } = await subscribed('2026-01-15');
    await expect(db.$executeRaw`UPDATE "Subscription" SET status = 'paused' WHERE id = ${sub.id}::uuid`).rejects.toThrow('Subscription_paused_until');
  });

  it('the unused paid days survive months of different lengths', async () => {
    const { sub, actor } = await subscribed('2026-01-01'); // paid Jan 1 – Feb 1
    const set = await pause(actor, sub.id, 1, day('2026-01-20')); // 12 days unused
    expect([set.pausedUntil, set.currentPeriodEnd].map(iso)).toEqual(['2026-02-17', '2026-03-01']); // Feb 17 – Mar 1: still 12
  });
});
