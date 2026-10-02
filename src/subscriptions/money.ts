// Money is Int cents. Dollar strings are split on the point and never pass through a float.

/** "29.99" / "$1,200" / "5.5" → cents, or null if it is not a plain non-negative USD amount. */
export function parseCents(input: string): number | null {
  const m = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const cents = Number(m[1]!.replaceAll(',', '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 2999 → "$29.99"; negative amounts (credits) get a leading minus. */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** `n / d` in basis points, rounded half-up; 0 when `d` is 0. */
export const ratioBps = (n: number, d: number) => (d ? Math.floor((n * 20_000 + d) / (2 * d)) : 0);

/** 1234 bps → "12.34%". */
export const formatBps = (bps: number) => `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;

/** `bps` basis points of `amountCents`, rounded half-up: a coupon's discount (P1-2). */
export const percentOfCents = (amountCents: number, bps: number) => prorateCents(amountCents, bps, 10_000);

/**
 * `amountCents × remainingDays / periodDays`, rounded half-up, in integers only (P0-5). Callers negate it for a
 * credit, so a credit and a charge of the same size round to the same magnitude.
 */
export function prorateCents(amountCents: number, remainingDays: number, periodDays: number): number {
  if (![amountCents, remainingDays, periodDays].every(Number.isSafeInteger) || amountCents < 0 || periodDays <= 0 || remainingDays < 0 || remainingDays > periodDays) {
    throw new Error(`cannot prorate ${amountCents} over ${remainingDays}/${periodDays} days`);
  }
  return Math.floor((2 * amountCents * remainingDays + periodDays) / (2 * periodDays));
}
