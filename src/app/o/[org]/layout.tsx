import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { NavLink } from '../../nav-link';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
// A member sees their subscription; an operator (org.update) sees the catalog, the subscribers and the metrics.
// The template's SaaS billing page (/settings/billing) stays off the nav so it is not mistaken for the member's.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  const operator = can(ctx.role, 'org.update');
  return (
    <>
      <nav aria-label="Main" className="org-nav">
        <strong>{org.name}</strong>
        <NavLink href={`${base}/subscription`}>My subscription</NavLink>
        {operator && (
          <>
            <NavLink href={`${base}/plans`}>Plans</NavLink>
            <NavLink href={`${base}/subscribers`}>Subscribers</NavLink>
            <NavLink href={`${base}/metrics`}>Metrics</NavLink>
          </>
        )}
        {can(ctx.role, 'members.manage') && <NavLink href={`${base}/settings/members`}>Members</NavLink>}
      </nav>
      {children}
    </>
  );
}
