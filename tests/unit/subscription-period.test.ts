import { describe, expect, it } from 'vitest';
import { periodFrom, shift, signupTerms } from '@/subscriptions/period';

// P0-3: anchored billing periods and trial conversion dates.
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('shift', () => {
  it('clamps to short months and keeps the anchor day for later months', () => {
    const jan31 = d('2026-01-31');
    expect([0, 1, 2, 3, 4].map((n) => iso(shift(jan31, n, 'month')))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('bills Feb 29 on Feb 29 in leap years and Feb 28 otherwise', () => {
    expect(iso(shift(d('2024-01-31'), 1, 'month'))).toBe('2024-02-29');
    const feb29 = d('2024-02-29');
    expect([1, 2, 3, 4].map((n) => iso(shift(feb29, n, 'year')))).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('crosses year boundaries', () => {
    expect(iso(shift(d('2026-12-31'), 2, 'month'))).toBe('2027-02-28');
  });
});

describe('periodFrom', () => {
  it('walks a 31st-anchored subscription: the 30th in 30-day months, back to the 31st after', () => {
    const anchor = d('2026-03-31');
    let start = anchor;
    const ends: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = periodFrom(anchor, 'month', start);
      ends.push(iso(p.end));
      start = p.end;
    }
    expect(ends).toEqual(['2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31']);
  });

  it('refuses a start that is not one of the anchor’s billing dates', () => {
    expect(() => periodFrom(d('2026-01-31'), 'month', d('2026-02-27'))).toThrow(/not a billing date/);
    expect(() => periodFrom(d('2026-01-31'), 'year', d('2026-02-28'))).toThrow(/not a billing date/);
    expect(() => periodFrom(d('2026-03-31'), 'month', d('2026-02-28'))).toThrow(/not a billing date/);
  });
});

describe('signupTerms', () => {
  it('a trial ends on signup + trialDays, and the conversion charge falls then, not at signup', () => {
    const t = signupTerms({ interval: 'month', trialDays: 14 }, new Date('2026-01-20T23:30:00Z'));
    expect(t.status).toBe('trialing');
    expect([t.currentPeriodStart, t.currentPeriodEnd, t.billingAnchor, t.nextBillingDate].map(iso)).toEqual([
      '2026-01-20',
      '2026-02-03',
      '2026-02-03',
      '2026-02-03',
    ]);
    // after the conversion charge, the first paid period runs from trial end on the trial-end anchor
    const paid = periodFrom(t.billingAnchor, 'month', t.nextBillingDate);
    expect([iso(paid.start), iso(paid.end)]).toEqual(['2026-02-03', '2026-03-03']);
  });

  it('without a trial: active, anchored on signup day, the first period paid at signup and the next due at its end', () => {
    const t = signupTerms({ interval: 'month', trialDays: 0 }, d('2026-01-31'));
    expect(t.status).toBe('active');
    expect([t.currentPeriodStart, t.currentPeriodEnd, t.billingAnchor, t.nextBillingDate].map(iso)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-01-31',
      '2026-02-28',
    ]);
    expect(periodFrom(t.billingAnchor, 'month', t.currentPeriodStart)).toEqual({ start: t.currentPeriodStart, end: t.currentPeriodEnd });
  });

  it('annual plans anchor a year out', () => {
    const t = signupTerms({ interval: 'year', trialDays: 0 }, d('2024-02-29'));
    expect(iso(t.currentPeriodEnd)).toBe('2025-02-28');
  });
});
