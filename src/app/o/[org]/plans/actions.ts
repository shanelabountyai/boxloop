'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { parseCents } from '@/subscriptions/money';

// P0-1 plan catalog. Operators (org.update: owner, admin) manage it. Price terms are fixed at
// creation (D-001; a DB trigger enforces it), so edit renames and archive retires.
const page = (ctx: OrgCtx) => `/o/${ctx.slug}/plans`;
const name = z.string().trim().min(1, 'Give the plan a name.').max(120);

export const createPlan = orgAction(
  'org.update',
  z.object({
    name,
    price: z.string().max(20),
    interval: z.enum(['month', 'year']),
    trialDays: z.coerce.number().int('Trial length is whole days.').min(0).max(365, 'Trials are at most 365 days.').default(0),
  }),
  async (ctx, i) => {
    const priceCents = parseCents(i.price);
    if (priceCents === null) throw new Refused('Enter the price as dollars, like 29 or 29.99.');
    await db.$transaction(async (tx) => {
      const p = await tx.plan.create({ data: { ...inOrg(ctx), name: i.name, priceCents, interval: i.interval, trialDays: i.trialDays } });
      await audit(ctx, 'plan.created', { targetType: 'plan', targetId: p.id }, tx);
    });
    redirect(page(ctx));
  },
);

export const renamePlan = orgAction('org.update', z.object({ id: ref('plan'), name }), async (ctx, i) => {
  await db.$transaction(async (tx) => {
    const { count } = await tx.plan.updateMany({ where: { id: i.id, ...inOrg(ctx) }, data: { name: i.name } });
    if (count !== 1) notFound(); // another org's plan ≡ no plan (INV-02/04)
    await audit(ctx, 'plan.renamed', { targetType: 'plan', targetId: i.id }, tx);
  });
  redirect(page(ctx));
});

/** Hides the plan from signup. Existing subscribers keep it unchanged (grandfathering). */
export const archivePlan = orgAction('org.update', z.object({ id: ref('plan') }), async (ctx, { id }) => {
  await db.$transaction(async (tx) => {
    const plan = await tx.plan.findFirst({ where: { id, ...inOrg(ctx) }, select: { archivedAt: true } });
    if (!plan) notFound();
    if (plan.archivedAt) return; // already archived: keep the first date
    await tx.plan.update({ where: { id }, data: { archivedAt: now() } });
    await audit(ctx, 'plan.archived', { targetType: 'plan', targetId: id }, tx);
  });
  redirect(page(ctx));
});
