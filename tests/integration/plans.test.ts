import { beforeEach, describe, expect, it } from 'vitest';
import { archivePlan, createPlan, renamePlan } from '@/app/o/[org]/plans/actions';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

// P0-1: the plan catalog. Price terms are fixed (D-001) and archive grandfathers.
beforeEach(resetAuthTables);

const plan = (orgId: string, over: Partial<{ priceCents: number; trialDays: number }> = {}) =>
  db.plan.create({ data: { orgId, name: 'Hobby Box', priceCents: 3000, interval: 'month', trialDays: 14, ...over } });

describe('plan table', () => {
  it('rejects a negative price and an out-of-range trial', async () => {
    const org = await makeOrg();
    await expect(plan(org.id, { priceCents: -1 })).rejects.toThrow(/plan_price_nonnegative/);
    await expect(plan(org.id, { trialDays: -1 })).rejects.toThrow(/plan_trial_days_range/);
    await expect(plan(org.id, { trialDays: 366 })).rejects.toThrow(/plan_trial_days_range/);
  });

  it('refuses any change to price, interval or trial, and allows rename and archive', async () => {
    const p = await plan((await makeOrg()).id);
    for (const data of [{ priceCents: 3100 }, { interval: 'year' as const }, { trialDays: 7 }])
      await expect(db.plan.update({ where: { id: p.id }, data })).rejects.toThrow(/plan_terms_immutable/);
    await db.plan.update({ where: { id: p.id }, data: { name: 'Renamed', archivedAt: new Date() } });
    expect(await db.plan.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: 'Renamed', priceCents: 3000, trialDays: 14 });
  });
});

describe('plan actions', () => {
  it('an admin creates a plan with the price parsed to cents, and audits it', async () => {
    const org = await makeOrg();
    const admin = await addMember(org.id, 'admin', 'admin@example.test');
    await actAs(admin.id, org.slug);
    await expect(createPlan(org.slug, { name: 'Pro Box', price: '$59.99', interval: 'year', trialDays: '0' })).rejects.toThrow(NavSignal);
    expect(await db.plan.findFirstOrThrow({ where: { orgId: org.id } })).toMatchObject({ name: 'Pro Box', priceCents: 5999, interval: 'year', trialDays: 0 });
    expect(await db.auditEvent.count({ where: { action: 'plan.created' } })).toBe(1);
  });

  it('refuses a malformed price without writing', async () => {
    const org = await makeOrg();
    await actAs((await addMember(org.id, 'owner', 'o@example.test')).id, org.slug);
    expect(await createPlan(org.slug, { name: 'X', price: '29.999', interval: 'month' })).toEqual({ error: expect.stringContaining('dollars') });
    expect(await db.plan.count()).toBe(0);
  });

  it('a member cannot manage plans', async () => {
    const org = await makeOrg();
    await actAs((await addMember(org.id, 'member', 'm@example.test')).id, org.slug);
    await expect(createPlan(org.slug, { name: 'X', price: '1', interval: 'month' })).rejects.toThrow();
    expect(await db.plan.count()).toBe(0);
  });

  it('archive keeps the terms, stamps archivedAt once, and rename leaves the terms alone', async () => {
    const org = await makeOrg();
    await actAs((await addMember(org.id, 'owner', 'o@example.test')).id, org.slug);
    const p = await plan(org.id);
    await expect(archivePlan(org.slug, { id: p.id })).rejects.toThrow(NavSignal);
    const archived = await db.plan.findUniqueOrThrow({ where: { id: p.id } });
    await expect(archivePlan(org.slug, { id: p.id })).rejects.toThrow(NavSignal); // idempotent
    await expect(renamePlan(org.slug, { id: p.id, name: 'Legacy Box' })).rejects.toThrow(NavSignal);
    expect(await db.plan.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: 'Legacy Box', priceCents: 3000, archivedAt: archived.archivedAt });
    expect(await db.auditEvent.count({ where: { action: 'plan.archived' } })).toBe(1);
  });
});
