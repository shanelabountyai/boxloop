import { beforeEach, expect, it } from 'vitest';
import { passed, simulate } from '@/subscriptions/simulate';
import { resetAuthTables } from '../helpers/auth';

// D-009: the 180-day simulation meets the PRD's success metrics, and its numbers match a hand tally of the cohorts.
beforeEach(resetAuthTables);

it('runs 180 days with no duplicate charge, a reconciled ledger and the hand-tallied outcomes', async () => {
  const r = await simulate();
  expect(passed(r)).toBe(true);
  expect(r.duplicateCharges).toEqual({ ledger: 0, provider: 0 });
  // 5 cards never fixed (cancelled on day 10), 5 fixed by the member, 5 soft declines recovered on the day-1 retry.
  expect(r.dunning).toEqual({ opened: 15, recovered: 10, cancelled: 5, recoveryRateBps: 6667 });
  expect(r.runs.dunning).toEqual({ retried: 25, recovered: 5, cancelled: 5, skipped: 0 }); // 5×3 + 5×1 + 5×1; member fixes are not the run's
  // Cancelled: 5 dunning, 5 trials, 3 of the 5 period-end cancels (2 undone).
  expect(r.statuses).toEqual({ active: 37, cancelled: 13 });
  // Jan 31: 13 converted trials ($335) + 3 Pro ($180) + 2 annual ($40/month).
  expect(r.mrr[0]).toEqual({ date: '2026-01-31', mrrCents: 55_500, paying: 18 });
  expect(r.mrr.map((m) => m.mrrCents)).toEqual([55_500, 115_000, 108_500, 105_000, 111_500, 111_500]);
}, 60_000);
