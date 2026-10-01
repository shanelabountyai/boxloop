import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENTS, STATUSES, InvalidTransition, diagram, next, type SubscriptionEvent } from '@/subscriptions/state';

// P0-2: the state machine. Every (status, event) pair is either in the table or refused.
const allowed: [string, SubscriptionEvent, string][] = [
  ['trialing', 'convert', 'active'],
  ['trialing', 'payment_failed', 'past_due'], // D-002: a failed conversion charge enters dunning
  ['trialing', 'cancel', 'cancelled'], // D-002: nothing paid, nothing to honour
  ['active', 'payment_failed', 'past_due'],
  ['past_due', 'payment_recovered', 'active'],
  ['past_due', 'dunning_exhausted', 'cancelled'],
  ['active', 'pause', 'paused'],
  ['paused', 'resume', 'active'],
  ['active', 'cancel', 'pending_cancellation'],
  ['pending_cancellation', 'undo_cancel', 'active'],
  ['pending_cancellation', 'period_ended', 'cancelled'],
];

describe('subscription state machine', () => {
  it.each(allowed)('%s --%s--> %s', (from, event, to) => {
    expect(next(from as never, event)).toBe(to);
  });

  const refused = STATUSES.flatMap((s) => EVENTS.map((e) => [s, e] as const)).filter(
    ([s, e]) => !allowed.some(([f, ev]) => f === s && ev === e),
  );

  it('refuses every pair not in the table', () => {
    expect(refused.length).toBe(STATUSES.length * EVENTS.length - allowed.length);
    expect(refused.length).toBeGreaterThanOrEqual(10); // PRD success metric
    for (const [s, e] of refused) expect(() => next(s, e)).toThrow(InvalidTransition);
  });

  it('names the refusal, and the named edge cases are refused', () => {
    expect(() => next('trialing', 'pause')).toThrow(/cannot pause a trialing subscription/); // P0-7
    expect(() => next('cancelled', 'resume')).toThrow(InvalidTransition); // terminal
    expect(() => next('paused', 'cancel')).toThrow(InvalidTransition);
    expect(() => next('past_due', 'pause')).toThrow(InvalidTransition);
  });

  it('cancelled is terminal', () => {
    for (const e of EVENTS) expect(() => next('cancelled', e)).toThrow(InvalidTransition);
  });

  it('the documented diagram is generated from the table', () => {
    expect(readFileSync('docs/STATE_MACHINE.md', 'utf8')).toContain(diagram());
  });
});
