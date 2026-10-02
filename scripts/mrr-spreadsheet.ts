import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/core/db';
import { metricsOn } from '@/subscriptions/metrics';
import { SIM_ORG } from '@/subscriptions/simulate';

// `npm run mrr:check` after `npm run simulate`: the PRD's "MRR matches an independent spreadsheet" metric (D-013).
// Writes the sim org's raw audit events and plan prices into a CSV whose MRR columns are spreadsheet formulas, has
// LibreOffice evaluate them headless, and exits 1 unless every month end equals `replay()`. The sheet shares no code
// with metrics.ts: it gets raw events and list prices, and does the status carry-forward and pricing in formulas.
// Formulas use `;` separators (LibreOffice); open out/mrr-check/sheet.csv in LibreOffice to inspect it.
const OUT = join(process.cwd(), 'out', 'mrr-check');
const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

try {
  const org = await db.org.findUniqueOrThrow({ where: { slug: SIM_ORG } });
  const plans = await db.plan.findMany({ where: { orgId: org.id }, orderBy: { id: 'asc' } });
  const events = (await db.auditEvent.findMany({ where: { orgId: org.id, action: { startsWith: 'subscription.' } }, select: { id: true, targetId: true, action: true, data: true } }))
    .map((e) => ({ ...e, data: e.data as { on: string; to?: string; planId?: string } }))
    .sort((a, b) => (a.targetId! < b.targetId! ? -1 : a.targetId! > b.targetId! ? 1 : a.data.on < b.data.on ? -1 : a.data.on > b.data.on ? 1 : a.id < b.id ? -1 : 1));
  if (!events.length) throw new Error(`org ${SIM_ORG} has no subscription events: run \`npm run simulate\` first`);

  const last = events.reduce((m, e) => (e.data.on > m ? e.data.on : m), '');
  const dates: string[] = [];
  for (let [y, m] = events.reduce((f, e) => (e.data.on < f ? e.data.on : f), last).split('-').map(Number) as [number, number]; ; m++) {
    dates.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); // day 0 of the next month
    if (dates.at(-1)! >= last) break;
  }

  // A sub | B on | C action | D to | E plan | F status after | G plan after | H superseded on | I monthly | J paying (and ever active)
  // L..O plans: id, price, interval, monthly.  Q..S month ends: date, MRR cents, paying count.
  const n = events.length + 1;
  const rows = [['sub', 'on', 'action', 'to', 'plan', 'status', 'plan_now', 'until', 'monthly', 'paying', '', 'plan_id', 'price', 'interval', 'monthly', '', 'month_end', 'mrr_cents', 'paying']];
  events.forEach((e, k) => {
    const r = k + 2;
    rows.push([
      q(e.targetId!), e.data.on, e.action, q(e.data.to ?? ''), q(e.data.planId ?? ''),
      q(`=IF(OR(C${r}="subscription.plan_changed";C${r}="subscription.card_updated";C${r}="subscription.coupon_applied");F${r - 1};D${r})`),
      q(`=IF(C${r}="subscription.created";E${r};IF(C${r}="subscription.plan_changed";D${r};G${r - 1}))`),
      q(`=IF(A${r + 1}=A${r};B${r + 1};DATE(9999;12;31))`),
      q(`=VLOOKUP(G${r};$L$2:$O$${plans.length + 1};4;0)`),
      q(`=IF(AND(OR(F${r}="active";F${r}="past_due";F${r}="pending_cancellation");COUNTIFS($A$2:$A${r};A${r};$F$2:$F${r};"active")>0);1;0)`), // ever paid = ever active (D-016)
      '',
      ...(k < plans.length ? [q(plans[k]!.id), String(plans[k]!.priceCents), plans[k]!.interval, q(`=IF(N${r}="year";ROUND(M${r}/12;0);M${r})`)] : ['', '', '', '']),
      '',
      ...(k < dates.length
        ? [dates[k]!, q(`=SUMPRODUCT(($B$2:$B$${n}<=Q${r})*($H$2:$H$${n}>Q${r})*$J$2:$J$${n}*$I$2:$I$${n})`), q(`=SUMPRODUCT(($B$2:$B$${n}<=Q${r})*($H$2:$H$${n}>Q${r})*$J$2:$J$${n})`)]
        : []),
    ]);
  });
  if (plans.length > events.length || dates.length > events.length) throw new Error('more plans or month ends than event rows'); // never for the sim; the layout assumes it

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'sheet.csv'), rows.map((r) => r.join(',')).join('\n') + '\n');
  const csv = 'CSV:44,34,76,1,,0,false,true,false,false,false';
  execFileSync('soffice', ['--headless', `--infilter=${csv}`, '--convert-to', `csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false`, '--outdir', join(OUT, 'evaluated'), join(OUT, 'sheet.csv')], { stdio: 'ignore' });
  const sheet = readFileSync(join(OUT, 'evaluated', 'sheet.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));

  const replayed = await metricsOn(org.id, dates);
  let bad = 0;
  console.log('month end     spreadsheet          replay()');
  replayed.forEach((m, k) => {
    const [mrr, paying] = [Number(sheet[k]![17]), Number(sheet[k]![18])];
    const ok = mrr === m.mrrCents && paying === m.paying;
    if (!ok) bad++;
    console.log(`${m.date}  ${String(mrr).padStart(8)} (${String(paying).padStart(2)})   ${String(m.mrrCents).padStart(8)} (${String(m.paying).padStart(2)})  ${ok ? 'ok' : 'MISMATCH'}`);
  });
  console.log(`\n${events.length} events, ${plans.length} plans. ${bad ? `${bad} month ends DIFFER` : 'Every month end matches.'} Sheet: out/mrr-check/sheet.csv`);
  process.exitCode = bad ? 1 : 0;
} finally {
  await db.$disconnect();
}
