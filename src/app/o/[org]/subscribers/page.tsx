import Link from 'next/link';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { dunningOutlook, sequence } from '@/subscriptions/dunning';
import { formatCents } from '@/subscriptions/money';
import { calendarDay, formatDay } from '@/subscriptions/period';
import { STATUSES, type SubscriptionStatus } from '@/subscriptions/state';
import { endings, fullSub, StatusPill, statusLabel, summary } from '../subscription-ui';

export const metadata = { title: 'Subscribers' };

// Screen 3. Past-due members sit on top, soonest cancellation first, because that is where the operator acts.
export default async function Subscribers({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const today = calendarDay(now());
  const d = (x: Date) => formatDay(x, today);
  const q = (await searchParams).status;
  const filter = STATUSES.find((s) => s === q);
  const subs = await db.subscription.findMany({ where: inOrg(ctx), include: { ...fullSub, user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  const ends = await endings(subs.filter((s) => s.status === 'cancelled').map((s) => s.id));
  const base = `/o/${ctx.slug}/subscribers`;
  const who = (s: (typeof subs)[number]) => s.user.name ?? s.user.email;

  const pastDue = subs
    .filter((s) => s.status === 'past_due')
    .map((s) => {
      const seq = sequence(s);
      return { s, o: seq && dunningOutlook(seq) };
    })
    .sort((a, b) => (a.o?.cancelsOn.getTime() ?? 0) - (b.o?.cancelsOn.getTime() ?? 0));
  const count = (st?: SubscriptionStatus) => subs.filter((s) => !st || s.status === st).length;
  const shown = subs.filter((s) => !filter || s.status === filter);

  return (
    <main>
      <h1>Subscribers</h1>
      {pastDue.length > 0 ? (
        <section className="alert-block">
          <h2>
            <span aria-hidden="true">▲ </span>Past due · {pastDue.length}
          </h2>
          <p>Soonest cancellation first.</p>
          {pastDue.map(({ s, o }) => (
            <div key={s.id} className="due">
              <div>
                <strong>{who(s)}</strong>
                <br />
                <span className="muted">
                  {s.plan.name} · {formatCents(s.plan.priceCents)}/{s.plan.interval}
                </span>
              </div>
              <div className="num">
                <strong>{o?.retry ? `Retry ${o.retry.n} of ${o.retry.of} on ${d(o.retry.on)}` : 'No retries left'}</strong>
                <br />
                {o && `Cancels ${d(o.cancelsOn)} if unpaid`}
              </div>
              <Link href={`${base}/${s.id}`}>View</Link>
            </div>
          ))}
        </section>
      ) : (
        subs.length > 0 && <p className="muted">No past-due members.</p>
      )}

      <nav aria-label="Filter by status" className="filters">
        <Link href={base} aria-current={!filter ? 'page' : undefined}>
          All <span>{count()}</span>
        </Link>
        {STATUSES.map((st) => (
          <Link key={st} href={`${base}?status=${st}`} aria-current={filter === st ? 'page' : undefined}>
            {statusLabel(st)} <span>{count(st)}</span>
          </Link>
        ))}
      </nav>

      <section className="list">
        <h2>{filter ? statusLabel(filter) : 'All subscriptions'}</h2>
        {!shown.length && <p className="muted">{subs.length ? 'None in this state.' : 'No subscribers yet. Members appear here when they choose a plan.'}</p>}
        {shown.map((s) => (
          <Link key={s.id} href={`${base}/${s.id}`} className="sub-row">
            <span>
              <strong>{who(s)}</strong>
              <br />
              <span className="muted">{s.plan.name}</span>
            </span>
            <StatusPill status={s.status} />
            <span className="muted num">{summary(s, today, ends.get(s.id)).dates}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
