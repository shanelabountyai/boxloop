import { describe, expect, it } from 'vitest';
import { dunningOutlook } from '@/subscriptions/dunning';
import { pauseTerms } from '@/subscriptions/pause';
import { daysBetween } from '@/subscriptions/period';

// Two pure functions that members and operators read dates from (D-022 previews): the dunning outlook on
// the past-due card and the subscribers list, and the pause confirm. Expected dates are hand-computed.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date | null | undefined) => d && d.toISOString().slice(0, 10);

describe('dunningOutlook (D-005)', () => {
  const day0 = day('2026-02-14');
  const at = (...days: string[]) => ({ day0, attempts: days.map((d, i) => ({ attempt: i + 1, attemptedOn: day(d) })) as never });
  const view = (o: ReturnType<typeof dunningOutlook>) => ({ failedOn: iso(o.failedOn), retry: o.retry && { ...o.retry, on: iso(o.retry.on) }, cancelsOn: iso(o.cancelsOn) });

  it('after the failed attempt 1, the next retry is day 1 of 3 and it cancels on day 10', () => {
    expect(view(dunningOutlook(at('2026-02-14')))).toEqual({ failedOn: '2026-02-14', retry: { n: 1, of: 3, on: '2026-02-15' }, cancelsOn: '2026-02-24' });
  });

  it('each scheduled retry moves the outlook to the next one', () => {
    expect(view(dunningOutlook(at('2026-02-14', '2026-02-15'))).retry).toEqual({ n: 2, of: 3, on: '2026-02-17' });
    expect(view(dunningOutlook(at('2026-02-14', '2026-02-15', '2026-02-17'))).retry).toEqual({ n: 3, of: 3, on: '2026-02-21' });
  });

  it('a member retry between scheduled days is followed by the next scheduled day, and one on a scheduled day covers it', () => {
    expect(view(dunningOutlook(at('2026-02-14', '2026-02-16'))).retry).toEqual({ n: 2, of: 3, on: '2026-02-17' });
    expect(view(dunningOutlook(at('2026-02-14', '2026-02-17'))).retry).toEqual({ n: 3, of: 3, on: '2026-02-21' });
  });

  it('after the day-7 retry no retry is left, only the cancel day', () => {
    expect(view(dunningOutlook(at('2026-02-14', '2026-02-15', '2026-02-17', '2026-02-21')))).toEqual({ failedOn: '2026-02-14', retry: null, cancelsOn: '2026-02-24' });
  });
});

describe('pauseTerms (D-007)', () => {
  it('keeps a month-end anchor: Jan 31 member paused on Feb 10 for one period', () => {
    // Paid Jan 31 – Feb 28 (next bill Feb 28). One period on: next bill Mar 31, period Feb 28 – Mar 31.
    // 18 unused paid days (Feb 10 → Feb 28) run Mar 13 → Mar 31.
    const t = pauseTerms({ billingAnchor: day('2026-01-31'), interval: 'month', nextBillingDate: day('2026-02-28'), currentPeriodEnd: day('2026-02-28') }, 1, day('2026-02-10'));
    expect([t.currentPeriodStart, t.currentPeriodEnd, t.nextBillingDate, t.pausedUntil].map(iso)).toEqual(['2026-02-28', '2026-03-31', '2026-03-31', '2026-03-13']);
  });

  it('three periods from a short month land on the anchor day again', () => {
    // Next bill Feb 28 (index 1); +3 → index 4 = May 31, period Apr 30 – May 31. 27 unused days (Feb 1 → 28) → May 4.
    const t = pauseTerms({ billingAnchor: day('2026-01-31'), interval: 'month', nextBillingDate: day('2026-02-28'), currentPeriodEnd: day('2026-02-28') }, 3, day('2026-02-01'));
    expect([t.currentPeriodStart, t.nextBillingDate, t.pausedUntil].map(iso)).toEqual(['2026-04-30', '2026-05-31', '2026-05-04']);
  });

  it('a yearly pause is whole years (D-019) and keeps exactly the unused days across a leap year', () => {
    // Paid 2026-03-01 – 2027-03-01, paused 2026-09-01: 181 unused days. One year on: next bill 2028-03-01,
    // and 181 days before it (2028 has Feb 29) is 2027-09-02.
    const t = pauseTerms({ billingAnchor: day('2026-03-01'), interval: 'year', nextBillingDate: day('2027-03-01'), currentPeriodEnd: day('2027-03-01') }, 1, day('2026-09-01'));
    expect([t.currentPeriodStart, t.nextBillingDate, t.pausedUntil].map(iso)).toEqual(['2027-03-01', '2028-03-01', '2027-09-02']);
    expect(daysBetween(t.pausedUntil, t.nextBillingDate)).toBe(daysBetween(day('2026-09-01'), day('2027-03-01')));
  });

  it('refuses a next billing date that is not one of the anchor\'s billing dates', () => {
    expect(() => pauseTerms({ billingAnchor: day('2026-01-31'), interval: 'month', nextBillingDate: day('2026-02-27'), currentPeriodEnd: day('2026-02-27') }, 1, day('2026-02-10'))).toThrow(/not a billing date/);
  });
});
