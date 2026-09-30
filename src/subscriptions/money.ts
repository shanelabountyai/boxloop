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
