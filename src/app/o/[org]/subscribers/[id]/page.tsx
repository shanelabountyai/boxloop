import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { calendarDay, formatDay } from '@/subscriptions/period';
import { STATUSES, type SubscriptionStatus } from '@/subscriptions/state';
import { endings, fullSub, History, historyRows, planNames, statusFamily, statusLabel, SubCard } from '../../subscription-ui';

export const metadata = { title: 'Subscriber' };

type Data = { from?: string | null; to?: string; on?: string; planId?: string; pausedUntil?: string; card?: string; reason?: string; toPlanId?: string };
const isStatus = (s: unknown): s is SubscriptionStatus => STATUSES.includes(s as SubscriptionStatus);

// Screen 4: one subscription, read-only, with its charges and every audited change. Another org's id is a 404 (INV-02).
export default async function Subscriber({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const p = await params;
  if (!z.uuid().safeParse(p.id).success) notFound();
  const sub = await db.subscription.findFirst({ where: { id: p.id, ...inOrg(ctx) }, include: { ...fullSub, user: { select: { name: true, email: true } } } });
  if (!sub) notFound();
  const today = calendarDay(now());
  const d = (x: Date) => formatDay(x, today);
  const [names, ends, events] = await Promise.all([
    planNames(ctx.orgId),
    endings([sub.id]),
    db.auditEvent.findMany({ where: { ...inOrg(ctx), targetType: 'subscription', targetId: sub.id }, orderBy: { id: 'desc' } }),
  ]);
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const plan = (id?: string) => (id && names.get(id)) || 'a plan';
  const member = sub.user.name ?? sub.user.email;

  const timeline = events.map((e) => {
    const x = (e.data ?? {}) as Data;
    const by = e.actorUserId === null ? 'System' : e.actorUserId === sub.userId ? member : `${actors.get(e.actorUserId) ?? 'Operator'} (operator)`;
    const move = isStatus(x.to) ? { from: isStatus(x.from) ? statusLabel(x.from) : '—', to: statusLabel(x.to) } : null;
    const note: Record<string, string> = {
      'subscription.created': `Subscribed to ${plan(x.planId)}`,
      'subscription.convert': 'Trial converted',
      'subscription.payment_failed': 'Payment failed',
      'subscription.payment_recovered': 'Payment recovered',
      'subscription.dunning_exhausted': 'Cancelled: payment not recovered after 3 retries',
      'subscription.pause': `Paused${x.pausedUntil ? ` until ${d(new Date(x.pausedUntil))}` : ''}`,
      'subscription.resume': 'Pause ended',
      'subscription.cancel': x.from === 'trialing' ? `Trial cancelled by ${by === 'System' ? 'the system' : by === member ? 'member' : by}` : `Cancelled by ${by === member ? 'member' : by}`,
      'subscription.undo_cancel': 'Cancellation undone',
      'subscription.period_ended': 'Paid-through date reached',
      'subscription.plan_changed': `Changed plan: ${plan(x.from ?? undefined)} → ${plan(x.to)}`,
      'subscription.card_updated': `Payment method updated (mock card ${x.card ?? ''})`.replace(' ()', ''),
      'subscription.coupon_applied': 'Coupon applied',
      'plan_change.declined': `Change to ${plan(x.toPlanId)} declined${x.reason ? `: ${x.reason.replace(/_/g, ' ')}` : ''}`,
    };
    return { id: String(e.id), on: x.on ? new Date(x.on) : calendarDay(e.at), by, move, note: note[e.action] ?? e.action, k: move && isStatus(x.to) ? statusFamily(x.to) : 'hold' };
  });

  return (
    <main>
      <div>
        <Link href={`/o/${ctx.slug}/subscribers`}>← Subscribers</Link>
        <h1>{member}</h1>
        <p className="muted">
          {sub.user.email} · {sub.plan.name}
        </p>
      </div>
      <SubCard sub={sub} today={today} ending={ends.get(sub.id)} readonly />
      <section className="bare">
        <h2>Charge history</h2>
        <History rows={historyRows(sub, names, today)} today={today} empty="No charges yet." />
      </section>
      <section className="bare">
        <h2>Audit timeline</h2>
        <ol className="timeline">
          {timeline.map((t) => (
            <li key={t.id} data-k={t.k}>
              <p className="muted num">
                <strong>{d(t.on)}</strong> · <span className={t.by === 'System' ? 'actor system' : 'actor'}>{t.by}</span>
              </p>
              {t.move && (
                <p>
                  <strong>
                    {t.move.from} → {t.move.to}
                  </strong>
                </p>
              )}
              <p className="muted">{t.note}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
