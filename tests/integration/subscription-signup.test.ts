import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { signup, SignupDeclined } from '@/subscriptions/signup';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-3: signup persists the billing cycle, scoped to unarchived plans in the actor's org.
beforeEach(resetAuthTables);

const iso = (date: Date) => date.toISOString().slice(0, 10);

async function setup(slug = 'acme') {
  const org = await makeOrg(slug);
  const member = await addMember(org.id, 'member', `m@${slug}.test`);
  const plan = (trialDays: number, archivedAt: Date | null = null) =>
    db.plan.create({ data: { orgId: org.id, name: 'Box', priceCents: 3000, interval: 'month', trialDays, archivedAt } });
  return { org, member, plan, actor: { orgId: org.id, userId: member.id } };
}

describe('signup', () => {
  it('a trial plan starts trialing, billing on trial end, and audits the start', async () => {
    const { plan, actor } = await setup();
    const p = await plan(14);
    const sub = await signup(actor, p.id, new Date('2026-01-31T12:00:00Z'));
    const row = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe('trialing');
    expect([row.currentPeriodStart, row.currentPeriodEnd, row.nextBillingDate, row.billingAnchor].map(iso)).toEqual([
      '2026-01-31',
      '2026-02-14',
      '2026-02-14',
      '2026-02-14',
    ]);
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: 'subscription.created', targetId: sub.id } });
    expect(ev.data).toEqual({ from: null, to: 'trialing', planId: p.id, on: '2026-01-31' });
  });

  it('a no-trial plan charges the first period at signup and starts active, paid through the period end', async () => {
    const { plan, actor } = await setup();
    const p = await plan(0);
    const keys: string[] = [];
    const row = await signup(actor, p.id, new Date('2026-01-31T00:00:00Z'), async (i) => (keys.push(i.idempotencyKey), { ok: true, ref: 'r1' }));
    expect(row.status).toBe('active');
    expect([row.nextBillingDate, row.currentPeriodEnd].map(iso)).toEqual(['2026-02-28', '2026-02-28']);
    expect(keys).toEqual([`${row.id}:2026-01-31:1`]);
    expect(await db.chargeAttempt.findMany({ select: { subscriptionId: true, attempt: true, amountCents: true, outcome: true, providerRef: true } })).toEqual([
      { subscriptionId: row.id, attempt: 1, amountCents: 3000, outcome: 'succeeded', providerRef: 'r1' },
    ]);
  });

  it('a declined first charge creates nothing', async () => {
    const { plan, actor } = await setup();
    const p = await plan(0);
    await expect(signup(actor, p.id, new Date('2026-01-31T00:00:00Z'), async () => ({ ok: false, reason: 'card_declined' }))).rejects.toThrow(SignupDeclined);
    expect([await db.subscription.count(), await db.chargeAttempt.count(), await db.auditEvent.count({ where: { action: 'subscription.created' } })]).toEqual([0, 0, 0]);
  });

  it('refuses archived plans and plans from another org', async () => {
    const { plan, actor } = await setup();
    const archived = await plan(0, new Date());
    await expect(signup(actor, archived.id, new Date())).rejects.toThrow(/not open for signup/);
    const other = await setup('other');
    const theirs = await other.plan(0);
    await expect(signup(actor, theirs.id, new Date())).rejects.toThrow(/not open for signup/);
    expect(await db.subscription.count()).toBe(0);
  });

  it('the database refuses a period that ends before it starts', async () => {
    const { plan, actor } = await setup();
    const p = await plan(0);
    const day = new Date('2026-01-31T00:00:00Z');
    await expect(
      db.subscription.create({
        data: { ...actor, planId: p.id, status: 'active', billingAnchor: day, currentPeriodStart: day, currentPeriodEnd: day, nextBillingDate: day },
      }),
    ).rejects.toThrow(/Subscription_period_order/);
  });
});
