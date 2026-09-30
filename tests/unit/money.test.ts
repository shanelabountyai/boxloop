import { describe, expect, it } from 'vitest';
import { formatCents, parseCents } from '@/subscriptions/money';

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
