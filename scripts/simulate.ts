import { db } from '@/core/db';
import { passed, report, simulate } from '@/subscriptions/simulate';

// `npm run simulate [-- --start=YYYY-MM-DD --days=N]`: the 180-day capstone (D-009). Wipes and reseeds the `sim` org
// in the local database, prints the summary, and exits 1 if a success metric broke.
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const start = arg('start') ?? '2026-01-01';
const days = Number(arg('days') ?? 180);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(days) || days < 1) {
  console.error('usage: npm run simulate -- [--start=YYYY-MM-DD] [--days=N]');
  process.exit(2);
}
try {
  const r = await simulate({ start: new Date(`${start}T00:00:00Z`), days });
  console.log(report(r));
  process.exitCode = passed(r) ? 0 : 1;
} finally {
  await db.$disconnect();
}
