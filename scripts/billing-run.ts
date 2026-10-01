import { now } from '@/core/clock';
import { db } from '@/core/db';
import { runBilling } from '@/subscriptions/billing-run';
import { runDunning } from '@/subscriptions/dunning';

// `npm run billing:run -- --date=YYYY-MM-DD`. The date defaults to today only here, at the edge (D-003).
const arg = process.argv.find((a) => a.startsWith('--date='))?.slice('--date='.length);
const asOf = arg === undefined ? now() : new Date(`${arg}T00:00:00Z`);
if (arg !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(arg) || asOf.toISOString().slice(0, 10) !== arg)) {
  console.error(`--date must be a real YYYY-MM-DD, got "${arg}"`);
  process.exit(2);
}
try {
  // Billing first, so a charge that fails today opens dunning today; its first retry is tomorrow either way.
  console.log(JSON.stringify({ date: asOf.toISOString().slice(0, 10), ...(await runBilling(asOf)), dunning: await runDunning(asOf) }));
} finally {
  await db.$disconnect();
}
