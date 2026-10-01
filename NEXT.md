# NEXT

## ▶ Next session here: P0-8 cancellation honouring paid-through (cancel → pending_cancellation, access to period end, a scheduled job flips to cancelled at period end, member can undo before then)

Done 2026-10-01: **P0-7 pause/resume** (D-007). `pause(actor, subId, periods, asOf)` in `src/subscriptions/pause.ts` moves the paid period and `nextBillingDate` N billing dates on and sets `pausedUntil`; `runBilling()` resumes due pauses before charging. `transition()` now takes an optional `also` (extra fields + guard), written and audited in the same update.

Carry into P0-8:
- The state machine already has `cancel` (active → pending_cancellation, trialing → cancelled), `undo_cancel` and `period_ended`. The flip at period end can follow `resumePauses()` in `billing-run.ts`: a step at the start of `runBilling` over rows whose `currentPeriodEnd <= asOf`.
- `paused` has no `cancel` edge yet. Decide whether a paused member can cancel (likely yes, effective at `currentPeriodEnd`, which a pause has moved later).
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, and check that `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty. `git checkout prisma/migrations/migration_lock.toml` before committing.
