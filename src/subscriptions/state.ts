// P0-2: the subscription state machine. This table is the single source of truth: status changes go
// only through `next` (pure) and `transition` (persisted, in ./transition.ts). docs/STATE_MACHINE.md
// embeds `diagram()`, and a test fails if the two drift.

export const STATUSES = ['trialing', 'active', 'past_due', 'paused', 'pending_cancellation', 'cancelled'] as const;
export type SubscriptionStatus = (typeof STATUSES)[number];

const TABLE = {
  convert: { trialing: 'active' },
  payment_failed: { trialing: 'past_due', active: 'past_due' }, // trialing: a failed conversion charge (D-002)
  payment_recovered: { past_due: 'active' },
  dunning_exhausted: { past_due: 'cancelled' }, // involuntary: the event name keeps it apart in reporting
  pause: { active: 'paused' }, // not from trialing (P0-7)
  resume: { paused: 'active' },
  cancel: { trialing: 'cancelled', active: 'pending_cancellation' }, // trialing: nothing paid to honour (D-002)
  undo_cancel: { pending_cancellation: 'active' },
  period_ended: { pending_cancellation: 'cancelled' },
} as const satisfies Record<string, Partial<Record<SubscriptionStatus, SubscriptionStatus>>>;

export type SubscriptionEvent = keyof typeof TABLE;
export const EVENTS = Object.keys(TABLE) as SubscriptionEvent[];

export class InvalidTransition extends Error {
  constructor(
    readonly from: SubscriptionStatus,
    readonly event: SubscriptionEvent,
  ) {
    super(`cannot ${event.replace(/_/g, ' ')} a ${from} subscription`);
  }
}

/** The status `event` moves `from` to, or throws InvalidTransition. */
export function next(from: SubscriptionStatus, event: SubscriptionEvent): SubscriptionStatus {
  const to = (TABLE[event] as Partial<Record<SubscriptionStatus, SubscriptionStatus>>)[from];
  if (!to) throw new InvalidTransition(from, event);
  return to;
}

/** Mermaid source for the table, embedded verbatim in docs/STATE_MACHINE.md. */
export const diagram = () =>
  [
    'stateDiagram-v2',
    '  [*] --> trialing',
    '  [*] --> active: no-trial plan',
    ...EVENTS.flatMap((e) => Object.entries(TABLE[e]).map(([from, to]) => `  ${from} --> ${to}: ${e}`)),
    '  cancelled --> [*]',
  ].join('\n');
