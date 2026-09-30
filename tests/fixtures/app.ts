import { db } from '@/core/db';

// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`. Ids are fixed: the harness reseeds between calls.
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { a: 500, b: 600 };

export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const plan = await db.plan.create({ data: { id: ID(base[key] + 1), orgId: org.orgId, name: `Fixture plan ${key}`, priceCents: 3000, interval: 'month', trialDays: 14 } });
  return { plan: plan.id };
}
