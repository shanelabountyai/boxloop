import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { Plan } from '@/generated/prisma/client';
import { ActionForm } from '@/core/ui/action-form';
import { invoiceFor } from '@/subscriptions/billing-run';
import { formatCents, percentOfCents } from '@/subscriptions/money';
import { pauseTerms } from '@/subscriptions/pause';
import { addDays, calendarDay, formatDay } from '@/subscriptions/period';
import { prorationLines } from '@/subscriptions/plan-change';
import { endings, type FullSub, History, historyRows, mySubscription, planNames, SubCard } from '../subscription-ui';
import { cancelMine, pauseMine, subscribe, switchMyPlan, undoMine, updateMyCard } from './actions';

export const metadata = { title: 'My subscription' };

type Bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => (...a: A) => R;
const BILLING_DAY = 'Your renewal is being processed today. Try again tomorrow.'; // D-020: the day before the run

// Screen 1 and the plan picker (screen 2). Every confirm shows its money and dates before the member commits,
// computed with the same functions the action runs (prorationLines, pauseTerms).
export default async function MySubscription({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const today = calendarDay(now());
  const bind: Bind = (fn) => fn.bind(null, ctx.slug);
  const [sub, plans, names] = await Promise.all([
    mySubscription(ctx),
    db.plan.findMany({ where: { ...inOrg(ctx), archivedAt: null }, orderBy: { priceCents: 'asc' } }),
    planNames(ctx.orgId),
  ]);
  const ending = sub?.status === 'cancelled' ? (await endings([sub.id])).get(sub.id) : undefined;

  return (
    <main>
      <h1>{sub ? 'My subscription' : 'Choose your plan'}</h1>
      {sub && (
        <SubCard sub={sub} today={today} ending={ending}>
          <Actions sub={sub} plans={plans} today={today} bind={bind} />
        </SubCard>
      )}
      {(!sub || sub.status === 'cancelled') && <Picker plans={plans} today={today} bind={bind} again={!!sub} />}
      {sub && (
        <section className="bare">
          <h2>Billing history</h2>
          <History rows={historyRows(sub, names, today)} today={today} empty={sub.status === 'trialing' ? `No charges yet. Your first charge is on ${formatDay(sub.nextBillingDate, today)}.` : 'No charges yet.'} />
        </section>
      )}
    </main>
  );
}

function Actions({ sub, plans, today, bind }: { sub: FullSub; plans: Plan[]; today: Date; bind: Bind }) {
  const d = (x: Date) => formatDay(x, today);
  const inPaidPeriod = today >= sub.currentPeriodStart && today < sub.currentPeriodEnd;
  switch (sub.status) {
    case 'past_due':
      return (
        <Confirm label="Update payment method" primary>
          <h3>Update payment method</h3>
          <p className="muted">The mock provider stands in for card entry.</p>
          <ActionForm action={bind(updateMyCard)}>
            <Choice name="card" value="approves" checked text="A card that approves" />
            <Choice name="card" value="declines" text="A card that declines" />
            <Box k="good" icon="●" text={`Saving retries the failed payment of ${formatCents(invoiceFor(sub).amountCents)} now.`} />
            <button type="submit" className="primary">Save and retry now</button>
          </ActionForm>
        </Confirm>
      );
    case 'pending_cancellation':
      return (
        <ActionForm action={bind(undoMine)}>
          <button type="submit" className="primary">Undo cancellation</button>
        </ActionForm>
      );
    case 'trialing':
    case 'active':
      return (
        <>
          <ChangePlan sub={sub} plans={plans} today={today} bind={bind} />
          {sub.status === 'active' && (
            <Confirm label="Pause">
              <h3>Pause subscription</h3>
              <p className="muted">Choose how many billing periods to skip.</p>
              {!inPaidPeriod ? <Box k="risk" icon="▲" text={BILLING_DAY} /> : (
                <ActionForm action={bind(pauseMine)}>
                  {[1, 2, 3].map((n) => {
                    const t = pauseTerms({ ...sub, interval: sub.plan.interval }, n, today);
                    return <Choice key={n} name="periods" value={String(n)} checked={n === 1} text={`${n} period${n > 1 ? 's' : ''}`} note={`until ${d(t.pausedUntil)}, next charge ${d(t.nextBillingDate)}`} />;
                  })}
                  <Box k="hold" icon="❚❚" text="Nothing is charged today." more="Your unused paid days are kept and continue after the pause." />
                  <button type="submit" className="primary">Pause</button>
                </ActionForm>
              )}
            </Confirm>
          )}
          <Confirm label={sub.status === 'trialing' ? 'Cancel trial' : 'Cancel'} danger>
            <h3>{sub.status === 'trialing' ? 'Cancel trial' : 'Cancel subscription'}</h3>
            <p className="muted">
              {sub.plan.name}, {formatCents(sub.plan.priceCents)}/{sub.plan.interval}.
            </p>
            {sub.status === 'trialing' ? (
              <Box k="done" icon="○" text="Your trial ends now, nothing was charged." more="You will lose access today." />
            ) : (
              <Box k="end" icon="◐" text={`You keep access until ${d(sub.currentPeriodEnd)}. Nothing more will be charged.`} more="You can undo this until then." />
            )}
            <ActionForm action={bind(cancelMine)}>
              <button type="submit" className="danger">{sub.status === 'trialing' ? 'End trial now' : 'Cancel subscription'}</button>
            </ActionForm>
          </Confirm>
        </>
      );
    default:
      return null;
  }
}

function ChangePlan({ sub, plans, today, bind }: { sub: FullSub; plans: Plan[]; today: Date; bind: Bind }) {
  const d = (x: Date) => formatDay(x, today);
  const options = plans.filter((p) => p.id !== sub.planId && p.interval === sub.plan.interval);
  // Both prices at the discount the period was paid at, as changePlan prices them (P1-2).
  const paid = (cents: number) => (sub.status === 'active' ? cents - percentOfCents(cents, sub.paidOffBps) : 0);
  return (
    <Confirm label="Change plan">
      <h3>Change plan</h3>
      <p className="muted">
        You are on {sub.plan.name}, {formatCents(sub.plan.priceCents)}/{sub.plan.interval}.
      </p>
      {!options.length && <p>There are no other plans to switch to.</p>}
      {options.map((p) => {
        let lines: ReturnType<typeof prorationLines> | null = null;
        if (sub.status === 'active') {
          try {
            lines = prorationLines(paid(sub.plan.priceCents), paid(p.priceCents), { start: sub.currentPeriodStart, end: sub.currentPeriodEnd }, today);
          } catch {
            return <PlanOption key={p.id} plan={p}><Box k="risk" icon="▲" text={BILLING_DAY} /></PlanOption>;
          }
        }
        const net = lines?.netCents ?? 0;
        const box = !lines ? <Box k="trial" icon="◔" text="No charge now." more={`Your trial still ends ${d(sub.nextBillingDate)}, then ${formatCents(p.priceCents)}/${p.interval}.`} />
          : net > 0 ? <Box k="good" icon="●" text={`You'll be charged ${formatCents(net)} today.`} more={`Then ${formatCents(p.priceCents)}/${p.interval} from ${d(sub.nextBillingDate)}.`} />
          : net < 0 ? <Box k="hold" icon="↺" text={`${formatCents(-net)} credit goes to your next invoice.`} more={`No refund to your card. Then ${formatCents(p.priceCents)}/${p.interval}.`} />
          : <Box k="good" icon="●" text="No charge today." />;
        return (
          <PlanOption key={p.id} plan={p}>
            {lines && (lines.creditCents || lines.chargeCents) ? (
              <div className="lines">
                <div className="line"><span>Credit for unused {sub.plan.name}, {lines.remainingDays} days</span><strong>{formatCents(lines.creditCents)}</strong></div>
                <div className="line"><span>{p.name} for the rest of the period, {lines.remainingDays} days</span><strong>{formatCents(lines.chargeCents)}</strong></div>
              </div>
            ) : null}
            {box}
            <ActionForm action={bind(switchMyPlan)}>
              <input type="hidden" name="planId" value={p.id} />
              <button type="submit" className="primary">{net > 0 ? `Pay ${formatCents(net)} and switch to ${p.name}` : `Switch to ${p.name}`}</button>
            </ActionForm>
          </PlanOption>
        );
      })}
    </Confirm>
  );
}

function Picker({ plans, today, bind, again }: { plans: Plan[]; today: Date; bind: Bind; again: boolean }) {
  const d = (x: Date) => formatDay(x, today);
  return (
    <section className="picker bare">
      {again && <h2>Start a new subscription</h2>}
      {!plans.length && <p className="muted">No plans are open for signup yet.</p>}
      <div className="plans">
        {plans.map((p) => {
          const price = `${formatCents(p.priceCents)}/${p.interval}`;
          const first = addDays(today, p.trialDays);
          return (
            <section key={p.id} className="card">
              <div className="card-head">
                <h3>{p.name}</h3>
                <p className="price">
                  {formatCents(p.priceCents)}
                  <span>/{p.interval}</span>
                </p>
              </div>
              <p className="muted">{p.trialDays ? `${p.trialDays} days free, then ${price}` : 'No trial. Charged at signup.'}</p>
              <p className="dates">{p.trialDays ? `No charge today. First charge ${d(first)} for ${formatCents(p.priceCents)}.` : `You'll be charged ${formatCents(p.priceCents)} today.`}</p>
              <p className="muted">{p.trialDays ? `Cancel any time before ${d(first)} and nothing is charged.` : `Then ${price}.`}</p>
              <ActionForm action={bind(subscribe)}>
                <input type="hidden" name="planId" value={p.id} />
                {!p.trialDays && (
                  <label className="check">
                    <input type="checkbox" name="card" value="declines" /> Demo: the mock provider declines this payment
                  </label>
                )}
                <button type="submit" className="primary">{p.trialDays ? `Start ${p.trialDays}-day trial` : `Pay ${formatCents(p.priceCents)} and subscribe`}</button>
              </ActionForm>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/** A confirm "dialog": the action's button opens it in place, and the confirm inside it is the only commit. */
function Confirm({ label, primary, danger, children }: { label: string; primary?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <details className="confirm">
      <summary className={primary ? 'primary' : danger ? 'link-danger' : undefined}>{label}</summary>
      <div className="dialog">{children}</div>
    </details>
  );
}

function PlanOption({ plan, children }: { plan: Plan; children: React.ReactNode }) {
  return (
    <div className="option">
      <p>
        <strong>{plan.name}</strong> <span className="muted">{formatCents(plan.priceCents)}/{plan.interval}</span>
      </p>
      {children}
    </div>
  );
}

function Box({ k, icon, text, more }: { k: string; icon: string; text: string; more?: string }) {
  return (
    <div className="box" data-k={k}>
      <strong>
        <span aria-hidden="true">{icon} </span>
        {text}
      </strong>
      {more && <span>{more}</span>}
    </div>
  );
}

function Choice({ name, value, text, note, checked }: { name: string; value: string; text: string; note?: string; checked?: boolean }) {
  return (
    <label className="choice">
      <span>
        <input type="radio" name={name} value={value} defaultChecked={checked} /> {text}
      </span>
      {note && <span className="muted">{note}</span>}
    </label>
  );
}
