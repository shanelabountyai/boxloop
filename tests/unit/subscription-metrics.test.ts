import { expect, it } from 'vitest';
import { monthlyCents, replay, type SubEvent, trialConversionBps } from '@/subscriptions/metrics';

// P1-1 (D-010): metrics folded from the audit stream. The simulation checks MRR against the rows; these are the edges it never reaches.
const plans = new Map([
  ['box', { id: 'box', priceCents: 3000, interval: 'month' as const }],
  ['big', { id: 'big', priceCents: 5000, interval: 'month' as const }],
  ['year', { id: 'year', priceCents: 10_000, interval: 'year' as const }],
]);
const created = (id: string, on: string, to: string, planId = 'box'): SubEvent => ({ targetId: id, action: 'subscription.created', data: { on, to, planId } });
const ev = (id: string, event: string, on: string, to: string): SubEvent => ({ targetId: id, action: `subscription.${event}`, data: { on, to } });

it('a failed conversion counts as converted once dunning recovers it, and as a lost trial when dunning gives up', () => {
  const [row] = replay(
    [
      created('a', '2026-01-01', 'trialing'), ev('a', 'payment_failed', '2026-01-15', 'past_due'), ev('a', 'payment_recovered', '2026-01-16', 'active'),
      created('b', '2026-01-01', 'trialing'), ev('b', 'payment_failed', '2026-01-15', 'past_due'), ev('b', 'dunning_exhausted', '2026-01-25', 'cancelled'),
    ],
    plans,
    ['2026-01-31'],
  );
  expect(row).toMatchObject({ trialsConverted: 1, trialsLost: 1, involuntaryChurn: 0, paying: 1, mrrCents: 3000 });
});

it('a failed conversion in dunning is not MRR until it pays; a paid member in dunning still is (D-016)', () => {
  const [row] = replay(
    [
      created('trial', '2026-01-01', 'trialing'), ev('trial', 'payment_failed', '2026-01-15', 'past_due'),
      created('paid', '2026-01-01', 'active'), ev('paid', 'payment_failed', '2026-01-20', 'past_due'),
    ],
    plans,
    ['2026-01-31'],
  );
  expect(row).toMatchObject({ paying: 1, mrrCents: 3000, trialing: 0 });
});

it('prices each day by the plan in force, leaves pauses out of MRR, and counts churn in the period it lands in', () => {
  const rows = replay(
    [
      created('a', '2026-01-01', 'active'),
      { targetId: 'a', action: 'subscription.plan_changed', data: { on: '2026-01-10', to: 'big' } },
      ev('a', 'cancel', '2026-01-20', 'pending_cancellation'), // still paid for, still MRR
      ev('a', 'period_ended', '2026-02-01', 'cancelled'),
      created('p', '2026-01-01', 'active'), ev('p', 'pause', '2026-01-05', 'paused'),
      created('y', '2026-01-02', 'active', 'year'),
      { targetId: 'y', action: 'subscription.card_updated', data: { on: '2026-01-03', to: '' } },
      { targetId: 'y', action: 'subscription.coupon_applied', data: { on: '2026-01-03', to: '' } },
    ],
    plans,
    ['2026-01-04', '2026-01-31', '2026-02-28'],
  );
  expect(rows.map((r) => [r.mrrCents, r.paying, r.voluntaryChurn])).toEqual([
    [3000 + 3000 + 833, 3, 0],
    [5000 + 833, 2, 0],
    [833, 1, 1],
  ]);
});

it('a yearly price rounds half-up to the cent per month', () => {
  expect([10_000, 10_002, 10_001].map((priceCents) => monthlyCents({ id: 'x', priceCents, interval: 'year' }))).toEqual([833, 834, 833]);
});

it('conversion is won over ended trials, half-up in basis points', () => {
  const row = { date: '', mrrCents: 0, paying: 0, trialing: 0, voluntaryChurn: 0, involuntaryChurn: 0 };
  expect(trialConversionBps([{ ...row, trialsConverted: 38, trialsLost: 5 }])).toBe(8837);
  expect(trialConversionBps([{ ...row, trialsConverted: 0, trialsLost: 0 }])).toBe(0);
});

it('refuses an event with no business day rather than stalling the fold', () => {
  const noDay = { targetId: 'a', action: 'subscription.convert', data: { to: 'active' } } as unknown as SubEvent;
  expect(() => replay([created('a', '2026-01-01', 'trialing'), noDay], plans, ['2026-01-31'])).toThrow(/no business day/);
});
