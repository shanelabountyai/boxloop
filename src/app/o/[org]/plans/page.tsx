import { inOrg, requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { formatCents } from '@/subscriptions/money';
import { archivePlan, createPlan, renamePlan } from './actions';

export const metadata = { title: 'Plans' };

// P0-1 plan catalog. Archived plans stay listed for reference; signup offers only active ones.
export default async function Plans({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const plans = await db.plan.findMany({ where: inOrg(ctx), orderBy: { createdAt: 'asc' } });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const manage = can(ctx.role, 'org.update');

  return (
    <main>
      <h1>Plans</h1>
      {plans.length === 0 && <p className="muted">No plans yet. Members can subscribe once you create one.</p>}
      {plans.map((p) => (
        <section key={p.id} className="card">
          <div className="card-head">
            <h2>
              {p.name}{' '}
              {p.archivedAt && (
                <span className="pill" data-k="done">
                  Archived
                </span>
              )}
            </h2>
            <p className="price">
              {formatCents(p.priceCents)}
              <span>/{p.interval}</span>
            </p>
          </div>
          <p className="muted">{p.trialDays > 0 ? `${p.trialDays} days free, then ${formatCents(p.priceCents)}/${p.interval}` : 'No trial, charged at signup'}</p>
          {manage && (
            <>
              <ActionForm action={bind(renamePlan)}>
                <input type="hidden" name="id" value={p.id} />
                <label>Name <input name="name" defaultValue={p.name} required maxLength={120} /></label>
                <button type="submit">Rename</button>
              </ActionForm>
              {!p.archivedAt && (
                <ActionForm action={bind(archivePlan)}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="secondary">Archive</button>
                </ActionForm>
              )}
            </>
          )}
        </section>
      ))}

      {manage && (
        <section className="card">
          <h2>New plan</h2>
          <p className="box" data-k="end">
            <strong>
              <span aria-hidden="true">◐ </span>Price, interval and trial cannot change later.
            </strong>
            <span>To reprice, create a new plan and archive the old one; current subscribers keep their terms.</span>
          </p>
          <ActionForm action={bind(createPlan)}>
            <label>Name <input name="name" required maxLength={120} /></label>
            <label>Price (USD) <input name="price" required inputMode="decimal" pattern="\$?[0-9,]+(\.[0-9]{1,2})?" placeholder="29.99" /></label>
            <label>
              Billed every{' '}
              <select name="interval" defaultValue="month">
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
            </label>
            <label>Trial days <input name="trialDays" type="number" min={0} max={365} defaultValue={0} /></label>
            <button type="submit" className="primary">Create plan</button>
          </ActionForm>
        </section>
      )}
    </main>
  );
}
