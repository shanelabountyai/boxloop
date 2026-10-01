import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { type Charger, mockCharger, runBilling } from '@/subscriptions/billing-run';
import { undoCancel } from '@/subscriptions/cancel';
import { pause } from '@/subscriptions/pause';
import { addDays } from '@/subscriptions/period';
import { signup } from '@/subscriptions/signup';
import { InvalidTransition } from '@/subscriptions/state';
import { transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-8: a cancellation keeps the paid period, ends on its last day without a charge, and can be taken back until then.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });

/** A $30/month member who signed up (and, without a trial, paid Jan 15 – Feb 15) on `on`. */
async function subscribed(on = '2026-01-15', trialDays = 0) {
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

describe('cancel', () => {
  it('keeps access to the end of the paid period, then the billing run ends it without charging', async () => {
    const { sub, actor } = await subscribed();
    await transition(actor, sub.id, 'cancel', day('2026-01-20'));
    expect(await daily('2026-01-20', '2026-02-14')).toEqual([]);
    expect((await row(sub.id)).status).toBe('pending_cancellation');

    expect(await daily('2026-02-15', '2026-03-31')).toEqual([]); // Feb 15 would have renewed
    expect((await row(sub.id)).status).toBe('cancelled');
    const actions = await db.auditEvent.findMany({ where: { targetId: sub.id, action: { in: ['subscription.cancel', 'subscription.period_ended'] } }, orderBy: { id: 'asc' } });
    expect(actions.map((a) => [a.action, a.actorUserId])).toEqual([
      ['subscription.cancel', actor.userId],
      ['subscription.period_ended', null], // once, however often the run repeats
    ]);
  });

  it('a trial cancels at once, with nothing charged', async () => {
    const { sub, actor } = await subscribed('2026-01-15', 14);
    await transition(actor, sub.id, 'cancel', day('2026-01-20'));
    expect((await row(sub.id)).status).toBe('cancelled');
    expect(await daily('2026-01-29', '2026-01-29')).toEqual([]);
  });

  it('undone before the paid-through date, it renews on the usual billing date', async () => {
    const { sub, actor } = await subscribed();
    await transition(actor, sub.id, 'cancel', day('2026-01-20'));
    expect(await undoCancel(actor, sub.id, day('2026-02-14'))).toBe('active');
    expect(await daily('2026-02-14', '2026-02-15')).toEqual(['2026-02-15']);
    expect((await row(sub.id)).status).toBe('active');
  });

  it('cannot be undone on or after the paid-through date, even before the run has ended it', async () => {
    const { sub, actor } = await subscribed();
    await transition(actor, sub.id, 'cancel', day('2026-01-20'));
    await expect(undoCancel(actor, sub.id, day('2026-02-15'))).rejects.toThrow('can no longer be undone');
    expect((await row(sub.id)).status).toBe('pending_cancellation');
    await daily('2026-02-15', '2026-02-15');
    await expect(undoCancel(actor, sub.id, day('2026-02-15'))).rejects.toThrow('can no longer be undone');
    await expect(transition(actor, sub.id, 'undo_cancel', day('2026-02-15'))).rejects.toBeInstanceOf(InvalidTransition);
  });

  it('refuses a paused subscription, which can cancel once the pause ends (D-008)', async () => {
    const { sub, actor } = await subscribed();
    await pause(actor, sub.id, 1, day('2026-02-01'));
    await expect(transition(actor, sub.id, 'cancel', day('2026-02-01'))).rejects.toBeInstanceOf(InvalidTransition);
    expect((await row(sub.id)).status).toBe('paused');
  });
});
