import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { InvalidTransition } from '@/subscriptions/state';
import { StaleTransition, transition } from '@/subscriptions/transition';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

// P0-2: transition() is the one persisted writer of Subscription.status, and it audits every move.
beforeEach(resetAuthTables);

async function subscribed(status: 'trialing' | 'active' = 'trialing', slug = 'acme') {
  const org = await makeOrg(slug);
  const member = await addMember(org.id, 'member', `m@${slug}.test`);
  const plan = await db.plan.create({ data: { orgId: org.id, name: 'Hobby Box', priceCents: 3000, interval: 'month', trialDays: 14 } });
  const day = new Date('2026-01-01T00:00:00Z');
  const sub = await db.subscription.create({
    data: { orgId: org.id, userId: member.id, planId: plan.id, status, billingAnchor: day, currentPeriodStart: day, currentPeriodEnd: new Date('2026-01-15T00:00:00Z'), nextBillingDate: day },
  });
  return { org, member, sub, actor: { orgId: org.id, userId: member.id } };
}

describe('transition()', () => {
  it('moves the status and audits who/what/when/from/to', async () => {
    const { sub, actor, member } = await subscribed();
    expect(await transition(actor, sub.id, 'convert')).toBe('active');
    expect(await transition({ ...actor, userId: null }, sub.id, 'payment_failed')).toBe('past_due'); // a system job
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('past_due');
    const events = await db.auditEvent.findMany({ where: { targetId: sub.id }, orderBy: { id: 'asc' } });
    expect(events).toMatchObject([
      { action: 'subscription.convert', actorUserId: member.id, targetType: 'subscription', data: { from: 'trialing', to: 'active' } },
      { action: 'subscription.payment_failed', actorUserId: null, data: { from: 'active', to: 'past_due' } },
    ]);
    expect(events[0]?.at).toBeInstanceOf(Date);
  });

  it('refuses an invalid transition without writing', async () => {
    const { sub, actor } = await subscribed();
    await expect(transition(actor, sub.id, 'pause')).rejects.toThrow(InvalidTransition); // pause in trial (P0-7)
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('trialing');
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("treats another org's subscription as missing", async () => {
    const { sub } = await subscribed('trialing', 'acme');
    const other = await makeOrg('other');
    await expect(transition({ orgId: other.id, userId: null }, sub.id, 'convert')).rejects.toThrow(/not found/);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('trialing');
  });

  it('rolls back with the caller transaction, audit included', async () => {
    const { sub, actor } = await subscribed();
    await expect(
      db.$transaction(async (tx) => {
        await transition(actor, sub.id, 'convert', tx);
        throw new Error('charge failed later');
      }),
    ).rejects.toThrow('charge failed later');
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('trialing');
    expect(await db.auditEvent.count()).toBe(0);
  });

  it('two racing transitions: exactly one wins, and one audit row', async () => {
    const { sub, actor } = await subscribed('active');
    const results = await Promise.allSettled([transition(actor, sub.id, 'cancel'), transition(actor, sub.id, 'pause')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toSatisfy((e) => e instanceof StaleTransition || e instanceof InvalidTransition);
    expect(await db.auditEvent.count({ where: { targetId: sub.id } })).toBe(1);
  });

  it('deleting the org takes its subscriptions and plans with it', async () => {
    const { org } = await subscribed();
    await db.org.delete({ where: { id: org.id } });
    expect(await db.subscription.count()).toBe(0);
    expect(await db.plan.count()).toBe(0);
  });
});

describe('single writer', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? (f === 'generated' ? [] : files(join(dir, f))) : [join(dir, f)]));

  it('no file under src/ but transition.ts updates a subscription', () => {
    const writers = files('src').filter((f) => /subscription\.(update|updateMany|upsert)\b/.test(readFileSync(f, 'utf8')));
    expect(writers).toEqual(['src/subscriptions/transition.ts']);
  });
});
