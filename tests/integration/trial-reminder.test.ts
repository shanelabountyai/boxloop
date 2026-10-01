import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { runBilling } from '@/subscriptions/billing-run';
import { signup } from '@/subscriptions/signup';
import { applyCoupon, transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P1-3: one reminder, 3 days before a trial converts, however many times the billing run goes.
beforeEach(resetAuthTables);

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function trial() {
  const org = await makeOrg('acme');
  const member = await addMember(org.id, 'member', 'm@acme.test');
  const plan = await db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays: 14 } });
  const sub = await signup({ orgId: org.id, userId: member.id }, plan.id, day('2026-01-31')); // converts 2026-02-14
  return { actor: { orgId: org.id, userId: member.id }, sub };
}

const reminders = () => db.outbox.findMany({ select: { to: true, template: true, data: true } });

describe('trial-ending reminder', () => {
  it('queues once on day -3; reruns and later days add nothing, and conversion still charges', async () => {
    const { sub } = await trial();
    await runBilling(day('2026-02-10'));
    expect(await reminders()).toEqual([]);

    for (const d of ['2026-02-11', '2026-02-11', '2026-02-12', '2026-02-13']) await runBilling(day(d));
    expect(await reminders()).toEqual([
      {
        to: 'm@acme.test',
        template: 'notice',
        data: { subject: 'Your trial ends soon', body: 'Your free trial of Box ends on 2026-02-14. Your card will be charged $30.00 that day unless you cancel before then.' },
      },
    ]);
    expect(await db.trialReminder.findUniqueOrThrow({ where: { subscriptionId: sub.id } })).toMatchObject({ trialEndsOn: day('2026-02-14'), queuedOn: day('2026-02-11') });

    expect(await runBilling(day('2026-02-14'))).toMatchObject({ succeeded: 1 });
    expect(await db.outbox.count()).toBe(1);
  });

  it('a run that missed day -3 still reminds on day -1, but not on conversion day', async () => {
    await trial();
    await runBilling(day('2026-02-13'));
    expect(await db.outbox.count()).toBe(1);

    await resetAuthTables();
    await trial();
    await runBilling(day('2026-02-14'));
    expect(await db.outbox.count()).toBe(0);
  });

  it('quotes the conversion invoice, coupon off', async () => {
    const { actor, sub } = await trial();
    await applyCoupon(actor, sub.id, 5000, 1, day('2026-02-01'));
    await runBilling(day('2026-02-11'));
    expect((await reminders())[0]!.data).toMatchObject({ body: expect.stringContaining('charged $15.00') });
  });

  it('a cancelled trial gets none', async () => {
    const { actor, sub } = await trial();
    await transition(actor, sub.id, 'cancel', day('2026-02-05'));
    await runBilling(day('2026-02-11'));
    expect(await db.outbox.count()).toBe(0);
  });

  it('two racing runs queue one reminder', async () => {
    await trial();
    await Promise.all([runBilling(day('2026-02-11')), runBilling(day('2026-02-11'))]);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.trialReminder.count()).toBe(1);
  });
});
