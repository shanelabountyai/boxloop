import { requireOrg } from '@/core/authz/guards';
import { now as today } from '@/core/clock';
import { monthlyMetrics, trialConversionBps } from '@/subscriptions/metrics';
import { formatBps, formatCents } from '@/subscriptions/money';
import { calendarDay, iso } from '@/subscriptions/period';

export const metadata = { title: 'Metrics' };

// P1-1: replayed from the subscription audit stream on each request (D-010), as of today (D-003: the page is the entry point).
export default async function Metrics({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const rows = await monthlyMetrics(ctx.orgId, iso(calendarDay(today())));
  const now = rows.at(-1);

  return (
    <main>
      <h1>Metrics</h1>
      {!now ? (
        <p>No subscriptions yet.</p>
      ) : (
        <>
          <div className="tiles">
            <section className="card">
              <p className="muted">MRR</p>
              <p className="big">{formatCents(now.mrrCents)}</p>
              <p className="muted">{now.paying} paying</p>
            </section>
            <section className="card">
              <p className="muted">Trial conversion</p>
              <p className="big">{formatBps(trialConversionBps(rows))}</p>
              <p className="muted">{now.trialing} in trial now</p>
            </section>
            <section className="card">
              <p className="muted">Churn, whole run</p>
              <p className="big">{rows.reduce((n, r) => n + r.voluntaryChurn + r.involuntaryChurn, 0)}</p>
              <p className="muted">
                {rows.reduce((n, r) => n + r.involuntaryChurn, 0)} payment not recovered, {rows.reduce((n, r) => n + r.voluntaryChurn, 0)} voluntary
              </p>
            </section>
          </div>
          <section className="card">
            <h2>Monthly recurring revenue</h2>
            <div className="bars" role="img" aria-label={`MRR by month end: ${rows.map((r) => `${r.date} ${formatCents(r.mrrCents)}`).join(', ')}`}>
              {rows.map((r) => (
                <div key={r.date}>
                  <span>{formatCents(r.mrrCents)}</span>
                  <i style={{ height: `${Math.round((r.mrrCents / Math.max(1, ...rows.map((x) => x.mrrCents))) * 150)}px` }} />
                  <span className="muted">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
                </div>
              ))}
            </div>
          </section>
          <details>
            <summary>Month-by-month table</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Month end</th>
                <th scope="col">MRR</th>
                <th scope="col">Paying</th>
                <th scope="col">Trials converted</th>
                <th scope="col">Trials lost</th>
                <th scope="col">Voluntary churn</th>
                <th scope="col">Involuntary churn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <th scope="row">{r.date}</th>
                  <td>{formatCents(r.mrrCents)}</td>
                  <td>{r.paying}</td>
                  <td>{r.trialsConverted}</td>
                  <td>{r.trialsLost}</td>
                  <td>{r.voluntaryChurn}</td>
                  <td>{r.involuntaryChurn}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </details>
          <p className="muted">The last row is today. Churn counts paying members only; a trial that ends unpaid is a lost trial. Paused members are not in MRR.</p>
        </>
      )}
    </main>
  );
}
