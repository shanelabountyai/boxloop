// P0-3: the billing cycle. Dates are calendar days: UTC-midnight Dates, Postgres `date`. Pure: the caller
// passes the date in, never reads a clock here (D-003).

export type Interval = 'month' | 'year';

const DAY_MS = 86_400_000;

/** The UTC calendar day containing `at`. */
export const calendarDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export const addDays = (day: Date, n: number) => new Date(day.getTime() + n * DAY_MS);

/**
 * `anchor` moved `n` intervals on, its day clamped to the target month's length (Jan 31 → Feb 28 → Mar 31).
 * Always counted from the anchor, never from the previous period, so a short month cannot drag the anchor.
 */
export function shift(anchor: Date, n: number, interval: Interval): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + (interval === 'year' ? 12 * n : n);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), lastDay)));
}

/** Which billing date `day` is: `shift(anchor, n, interval)` equals `day`. Throws if it is not one. */
export function periodIndex(anchor: Date, interval: Interval, day: Date): number {
  const months = (day.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + day.getUTCMonth() - anchor.getUTCMonth();
  const n = interval === 'year' ? months / 12 : months;
  if (!Number.isInteger(n) || n < 0 || shift(anchor, n, interval).getTime() !== day.getTime()) {
    throw new Error(`${day.toISOString().slice(0, 10)} is not a billing date for anchor ${anchor.toISOString().slice(0, 10)}`);
  }
  return n;
}

/** The billing period starting on `start`, which must be one of the anchor's billing dates. */
export function periodFrom(anchor: Date, interval: Interval, start: Date): { start: Date; end: Date } {
  return { start, end: shift(anchor, periodIndex(anchor, interval, start) + 1, interval) };
}

/**
 * Billing fields for a signup on `asOf`. With a trial, the trial is the first period and its end is both
 * the anchor and the conversion charge date. Without one, the first period is charged on signup day.
 * `nextBillingDate` is always the start of the first unpaid period, so a charge on it is followed by
 * `periodFrom(billingAnchor, interval, nextBillingDate)`, both on conversion and on renewal.
 */
export function signupTerms(plan: { interval: Interval; trialDays: number }, asOf: Date) {
  const signup = calendarDay(asOf);
  const trialing = plan.trialDays > 0;
  const billingAnchor = trialing ? addDays(signup, plan.trialDays) : signup;
  return {
    status: trialing ? ('trialing' as const) : ('active' as const),
    billingAnchor,
    currentPeriodStart: signup,
    currentPeriodEnd: trialing ? billingAnchor : shift(billingAnchor, 1, plan.interval),
    nextBillingDate: billingAnchor,
  };
}
