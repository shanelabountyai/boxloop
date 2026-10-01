import { describe, expect, it } from 'vitest';
import { formatCents, parseCents, prorateCents } from '@/subscriptions/money';
import { prorationLines } from '@/subscriptions/plan-change';

describe('parseCents', () => {
  it.each([
    ['29.99', 2999], ['$29.99', 2999], ['30', 3000], ['5.5', 550], ['0', 0], ['0.01', 1],
    ['1,200', 120000], ['$1,200.05', 120005], [' 12.30 ', 1230],
    // the classic float trap: 0.1 + 0.2 and 1.15 * 100 both miss by a hair as floats
    ['0.30', 30], ['1.15', 115], ['4.35', 435],
  ])('%s → %i', (s, c) => expect(parseCents(s)).toBe(c));

  it.each(['', '-5', '1.234', '1,20', 'abc', '1e3', '.5', '5.', '$', '12,34.00', '99999999999999999'])('rejects %j', (s) =>
    expect(parseCents(s)).toBeNull(),
  );
});

describe('formatCents', () => {
  it.each([[2999, '$29.99'], [0, '$0.00'], [5, '$0.05'], [120005, '$1,200.05'], [-1500, '-$15.00']])('%i → %s', (c, s) =>
    expect(formatCents(c)).toBe(s),
  );

  it('round-trips', () => {
    for (const c of [0, 1, 99, 100, 2999, 123456789]) expect(parseCents(formatCents(c))).toBe(c);
  });
});

// P0-5 fixtures, each worked by hand: amount × remaining / period, then half-up.
describe('prorateCents', () => {
  it.each([
    [3000, 15, 30, 1500], // $30 halfway through a 30-day month
    [6000, 15, 30, 3000],
    [3000, 16, 31, 1548], // 1548.387 → down
    [6000, 16, 31, 3097], // 3096.774 → up
    [1001, 15, 30, 501], // 500.5 → half-up
    [1999, 15, 30, 1000], // 999.5 → half-up
    [1, 1, 2, 1], // 0.5 → 1
    [1, 1, 3, 0], // 0.333 → 0
    [2, 1, 3, 1], // 0.667 → 1
    [3000, 0, 30, 0], // last moment: nothing left
    [3000, 30, 30, 3000], // first day: the whole period
    [99900, 200, 365, 54740], // 54739.726 → up
  ])('%i × %i/%i → %i', (a, r, d, c) => expect(prorateCents(a, r, d)).toBe(c));

  it.each([[-1, 1, 30], [3000, 31, 30], [3000, -1, 30], [3000, 0, 0], [30.5, 1, 30], [3000, 1.5, 30]])('rejects %i × %i/%i', (a, r, d) =>
    expect(() => prorateCents(a, r, d)).toThrow(),
  );
});

describe('prorationLines', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const sep = { start: day('2026-09-01'), end: day('2026-10-01') }; // 30 days
  const jan = { start: day('2026-01-01'), end: day('2026-02-01') }; // 31 days

  it.each([
    ['upgrade halfway', 3000, 6000, sep, '2026-09-16', { remainingDays: 15, periodDays: 30, creditCents: -1500, chargeCents: 3000, netCents: 1500 }],
    ['downgrade halfway', 6000, 3000, sep, '2026-09-16', { remainingDays: 15, periodDays: 30, creditCents: -3000, chargeCents: 1500, netCents: -1500 }],
    ['31-day month', 3000, 6000, jan, '2026-01-16', { remainingDays: 16, periodDays: 31, creditCents: -1548, chargeCents: 3097, netCents: 1549 }],
    ['first day', 3000, 6000, sep, '2026-09-01', { remainingDays: 30, periodDays: 30, creditCents: -3000, chargeCents: 6000, netCents: 3000 }],
    ['last day', 3000, 6000, sep, '2026-09-30', { remainingDays: 1, periodDays: 30, creditCents: -100, chargeCents: 200, netCents: 100 }],
    ['each line rounds half-up on its own', 1001, 1999, sep, '2026-09-16', { remainingDays: 15, periodDays: 30, creditCents: -501, chargeCents: 1000, netCents: 499 }],
  ] as const)('%s', (_, from, to, period, on, lines) => expect(prorationLines(from, to, period, day(on))).toEqual(lines));

  it.each(['2026-08-31', '2026-10-01'])('rejects %s, outside the paid period', (on) =>
    expect(() => prorationLines(3000, 6000, sep, day(on))).toThrow(/outside the paid period/),
  );
});
