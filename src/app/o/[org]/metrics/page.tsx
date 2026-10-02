import { requireOrg } from '@/core/authz/guards';
import { monthlyMetrics, trialConversionBps } from '@/subscriptions/metrics';
import { formatBps, formatCents } from '@/subscriptions/money';
import { calendarDay, iso } from '@/subscriptions/period';

export const metadata = { title: 'Metrics' };

// P1-1: replayed from the subscription audit stream on each request (D-010), as of today (D-003: the page is the entry point).
export default async function Metrics({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const rows = await monthlyMetrics(ctx.orgId, iso(calendarDay(new Date())));
  const now = rows.at(-1);

  return (
    <main>
      <h1>Metrics</h1>
      {!now ? (
        <p>No subscriptions yet.</p>
      ) : (
        <>
          <p>
            MRR <strong>{formatCents(now.mrrCents)}</strong> · {now.paying} paying · {now.trialing} in trial · trial conversion <strong>{formatBps(trialConversionBps(rows))}</strong>
          </p>
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
          <p>The last row is today. Churn counts paying members only; a trial that ends unpaid is a lost trial. Paused members are not in MRR.</p>
        </>
      )}
    </main>
  );
}
