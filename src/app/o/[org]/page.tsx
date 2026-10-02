import { redirect } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';

// The org's home is where each role acts: an operator's subscribers, a member's own subscription.
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  redirect(`/o/${ctx.slug}/${can(ctx.role, 'org.update') ? 'subscribers' : 'subscription'}`);
}
