'use server';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Charger } from '@/subscriptions/billing-run';
import { undoCancel } from '@/subscriptions/cancel';
import { updateCard } from '@/subscriptions/dunning';
import { pause } from '@/subscriptions/pause';
import { changePlan, PlanChangeDeclined } from '@/subscriptions/plan-change';
import { signup, SignupDeclined } from '@/subscriptions/signup';
import { InvalidTransition } from '@/subscriptions/state';
import { lostRace, transition } from '@/subscriptions/transition';

// The member's own subscription (screen 1). Every action acts on the caller's newest subscription in the org,
// so no input names a subscription, and a member can never reach another member's. These are entry points, so
// they read the clock (D-003). Billing errors come back as the wording on the design board's notes.
const page = (ctx: OrgCtx) => `/o/${ctx.slug}/subscription`;
const actor = (ctx: OrgCtx) => ({ orgId: ctx.orgId, userId: ctx.userId });
const card = z.enum(['approves', 'declines']);
const declines: Charger = async () => ({ ok: false, reason: 'card_declined' });

function friendly(e: unknown): never {
  if (e instanceof Refused) throw e;
  if (e instanceof SignupDeclined) throw new Refused('Your card was declined, so no subscription was created. Try another card.');
  if (e instanceof PlanChangeDeclined) throw new Refused('Your card was declined, so nothing was changed. Update your payment method and try again.');
  if (e instanceof InvalidTransition && e.from === 'trialing' && e.event === 'pause') throw new Refused('Pausing is not available during a trial. You can cancel instead and nothing will be charged.');
  if (lostRace(e)) throw new Refused('Your subscription changed while you were deciding. Check it and try again.');
  const m = (e as Error).message ?? '';
  if (/outside the paid period|only inside a paid period/.test(m)) throw new Refused('Your renewal is being processed today. Try again tomorrow.'); // D-020
  if (/can no longer be undone/.test(m)) throw new Refused('Your paid period has ended, so the cancellation can no longer be undone.');
  if (/cannot change plan/.test(m)) throw new Refused('You can change plan during a trial or while your subscription is active.');
  if (/monthly and yearly/.test(m)) throw new Refused('Switching between monthly and yearly plans is not available.');
  throw e;
}

async function onMine(ctx: OrgCtx, fn: (subscriptionId: string) => Promise<unknown>) {
  const sub = await db.subscription.findFirst({ where: { ...inOrg(ctx), userId: ctx.userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (!sub) throw new Refused('You have no subscription yet.');
  try {
    await fn(sub.id);
  } catch (e) {
    friendly(e);
  }
  redirect(page(ctx));
}

/** A plan of this org open to choose; another org's plan is not found (INV-02). */
async function openPlan(ctx: OrgCtx, id: string) {
  const plan = await db.plan.findFirst({ where: { id, ...inOrg(ctx) }, select: { archivedAt: true } });
  if (!plan) notFound();
  if (plan.archivedAt) throw new Refused('That plan is no longer offered.');
}

export const subscribe = orgAction(null, z.object({ planId: ref('plan'), card: card.default('approves') }), async (ctx, i) => {
  await openPlan(ctx, i.planId);
  const live = await db.subscription.count({ where: { ...inOrg(ctx), userId: ctx.userId, status: { not: 'cancelled' } } });
  if (live) throw new Refused('You already have a subscription.');
  try {
    await signup(actor(ctx), i.planId, now(), i.card === 'declines' ? declines : undefined);
  } catch (e) {
    friendly(e);
  }
  redirect(page(ctx));
});

export const switchMyPlan = orgAction(null, z.object({ planId: ref('plan') }), async (ctx, i) => {
  await openPlan(ctx, i.planId);
  await onMine(ctx, (id) => changePlan(actor(ctx), id, i.planId, now()));
});

export const pauseMine = orgAction(null, z.object({ periods: z.coerce.number().int().min(1, 'Choose a pause of 1, 2 or 3 billing periods.').max(3, 'Choose a pause of 1, 2 or 3 billing periods.') }), async (ctx, i) => {
  await onMine(ctx, (id) => pause(actor(ctx), id, i.periods, now()));
});

export const cancelMine = orgAction(null, z.object({}), async (ctx) => {
  await onMine(ctx, (id) => transition(actor(ctx), id, 'cancel', now()));
});

export const undoMine = orgAction(null, z.object({}), async (ctx) => {
  await onMine(ctx, (id) => undoCancel(actor(ctx), id, now()));
});

/** Sets the mock card; a past_due subscription is retried with it at once (P0-6). */
export const updateMyCard = orgAction(null, z.object({ card }), async (ctx, i) => {
  await onMine(ctx, async (id) => {
    if ((await updateCard(actor(ctx), id, i.card, now())) === false) {
      revalidatePath(page(ctx)); // the failed retry is recorded; show it under the error
      throw new Refused('Your card was declined again. Try another card.');
    }
  });
});
