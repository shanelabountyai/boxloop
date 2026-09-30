# PRD: BoxLoop — Subscription & Membership Management

**Sample business:** "BoxLoop," a monthly hobby-supplies subscription box (works equally for a gym or SaaS)
**Builder:** Solo, in Claude Code
**Status:** Draft v1
**Learning objectives:** subscription state machines, recurring billing cycles, proration math, dunning logic, scheduled jobs, idempotent processing

---

## Problem Statement

Subscription businesses live or die on billing-state correctness: trials that convert on time, pauses that don't bill, failed payments that retry intelligently, and cancellations that honor the paid-through date. Manual tracking breaks immediately past a handful of members, and billing errors are the fastest way to lose customer trust (and trigger chargebacks). Rental/storage billing was transactional; this domain is stateful over time — the core new skill.

## Goals

1. Every member is always in exactly one well-defined subscription state, and every state change is auditable.
2. Billing runs are correct and idempotent: running the same billing day twice never double-charges.
3. Trials, pauses, plan changes, and cancellations all resolve to the right charge amount (including proration) without manual math.
4. Failed payments follow an automated dunning sequence instead of silently churning members.
5. **(Builder goal)** Exercise state machines, scheduled/batch jobs, idempotency, and money math — none of which the rental/storage projects required.

## Non-Goals

- **Real payment processing (Stripe etc.)** — a mock payment provider with configurable success/fail responses teaches the logic; the API integration teaches config. Mock it.
- **Physical fulfillment/shipping** — box logistics is inventory work already covered by prior projects.
- **Multi-currency** — USD only; currency adds precision complexity without new state concepts.
- **Sales tax** — jurisdictional logic is a compliance project, not a subscription-logic project.
- **Customer acquisition (marketing pages, funnels)** — assume members arrive; start at signup.

## Personas

- **Member** — signs up, manages plan, pauses, cancels.
- **Operator/Owner** — defines plans, runs billing, handles failed payments, reads revenue reports.

## User Stories (priority order)

1. As a member, I want to start a 14-day free trial without being charged so that I can evaluate before paying.
2. As a member, I want my trial to convert automatically to a paid plan so that service isn't interrupted (with a reminder before conversion).
3. As a member, I want to upgrade or downgrade my plan and be charged fairly for the partial period so that I'm not overpaying.
4. As a member, I want to pause my subscription for 1–3 months so that I don't have to cancel when traveling.
5. As a member, I want to cancel anytime and retain access until my paid-through date so that I get what I paid for.
6. As an operator, I want a daily billing run that charges everyone due today so that revenue collection is automatic.
7. As an operator, I want failed payments retried on a schedule with member notifications so that involuntary churn is minimized.
8. As an operator, I want MRR, active members, churn, and trial-conversion metrics so that I can see business health.
9. As a member, I want a clear billing history so that I can see every charge and credit. *(edge: proration credits must appear as line items)*

## Requirements

### Must-Have (P0)

**P0-1: Plan catalog**
Plans have name, price (integer cents — never floats), billing interval (monthly/annual), trial length.
- [ ] Admin can create/edit/archive plans
- [ ] Archiving hides from signup but existing subscribers continue unchanged (grandfathering)

**P0-2: Subscription state machine** *(the core learning artifact)*
States: `trialing → active → past_due → active | cancelled` ; `active ⇄ paused` ; `active → pending_cancellation → cancelled` (at period end); `past_due → cancelled` (dunning exhausted).
- [ ] Every transition is validated; invalid transitions rejected with an error
- [ ] Every transition writes an immutable audit event (who/what/when/from/to)
- [ ] State diagram documented in the repo and enforced in one module (single source of truth)

**P0-3: Billing cycle engine**
Each subscription has `current_period_start/end` and `next_billing_date`; anchored billing (signup on Jan 31 → Feb bills on Feb 28).
- [ ] Given signup on the 31st, when the next month has 30 days, then billing occurs on the 30th and the anchor is preserved for subsequent months
- [ ] Trial end date = signup + trial days; conversion charge occurs on trial end, not signup

**P0-4: Daily billing run (idempotent batch job)**
A runnable command (`billing:run --date=YYYY-MM-DD`) that charges all subscriptions due that date via the mock payment provider.
- [ ] Running the same date twice produces zero duplicate charges (idempotency key per subscription+period)
- [ ] Each attempt logs outcome; failures move the subscription to `past_due` and open a dunning schedule
- [ ] A run summary reports: attempted, succeeded, failed, skipped

**P0-5: Proration**
Mid-period plan changes charge/credit the difference for the remaining period, rounded half-up, in cents.
- [ ] Given a $30/mo plan upgraded to $60/mo halfway through the period, when the change applies, then an immediate ~$15 charge is created and the line items show the credit and new charge
- [ ] Downgrades produce a credit applied to the next invoice (no cash refunds in v1)
- [ ] All proration math has unit tests against hand-calculated fixtures

**P0-6: Dunning sequence**
On payment failure: retry at day 1, 3, 7; member notification (outbox log) at each retry; cancel at day 10 if unresolved.
- [ ] A successful retry returns the subscription to `active` and closes the sequence
- [ ] A member updating their (mock) payment method triggers an immediate retry
- [ ] Cancelled-via-dunning is distinguishable from voluntary cancellation in reporting

**P0-7: Pause/resume**
Pause for 1–3 billing periods; no charges while paused; billing anchor shifts by the pause length.
- [ ] Given a member paused for 2 months, when they resume, then the next billing date is exactly 2 months later than it would have been
- [ ] Pausing during trial is rejected (edge case)

**P0-8: Cancellation honoring paid-through**
- [ ] Cancel sets `pending_cancellation`; access continues to period end; a scheduled job flips to `cancelled` at period end
- [ ] Member can undo cancellation before period end

### Nice-to-Have (P1)

- **P1-1: Metrics dashboard** — MRR, active count, trial-conversion %, voluntary vs. involuntary churn, computed from the audit-event stream (good exercise: derive metrics from events, not current state).
- **P1-2: Coupons** — percent-off for N periods; interacts with proration (deliberately tricky — great test-writing material).
- **P1-3: Trial-ending reminder** — outbox notification 3 days before conversion.

### Future Considerations (P2)

- Real payment provider adapter (design the mock behind an interface now so swapping is one file)
- Annual↔monthly interval switching (hardest proration case; keep period math in one module)
- Refunds (requires negative invoices — keep invoice amounts signed)

## Success Metrics (evaluated against a seeded demo dataset + simulated clock)

**Leading**
- Idempotency: 0 duplicate charges across repeated billing runs in the test suite
- State machine coverage: 100% of defined transitions and ≥10 invalid-transition rejections tested
- Proration accuracy: all fixtures match hand-calculated values to the cent

**Lagging (simulated over a 6-month clock advance)**
- Dunning recovery rate computable and correct vs. hand-tallied seed data
- MRR chart matches an independent spreadsheet calculation of the same seed data

Measurement method: a `simulate` command that advances a virtual clock day-by-day for 180 days, running billing each day against ~50 seeded members with scripted behaviors (trials, upgrades, payment failures, pauses).

## Open Questions

- **(Builder)** Virtual clock design — inject a clock/time provider everywhere vs. pass `--date` into jobs? Injectable clock is more testable. *(blocking — decide before P0-3)*
- **(Builder)** Store money as integer cents confirmed? Yes — treat any float in money code as a bug. *(resolved)*
- **(Product)** Should pause be self-serve limited to 1×/year? V1: unlimited, log it, revisit with data. *(non-blocking)*

## Timeline / Phasing

- **Phase 1:** P0-1, P0-2, P0-3 (plans, state machine, period math) — build and test with no billing yet
- **Phase 2:** P0-4, P0-6 (billing run + dunning) — introduces batch jobs and idempotency
- **Phase 3:** P0-5, P0-7, P0-8 (proration, pause, cancellation) — the fiddly money/date math
- **Phase 4:** P1 dashboard + the 180-day simulation as the capstone demo

## Build Notes for Claude Code

- TDD the state machine and proration modules — they're pure logic and the most defect-prone
- The 180-day simulation doubles as your portfolio demo: one command, visible output, provable correctness
- CLAUDE.md must state: money = integer cents, time = injected clock, state changes = only through the state-machine module. These are the three conventions Claude will otherwise drift on across sessions
