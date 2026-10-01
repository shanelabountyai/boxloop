# NEXT

## ▶ Next session here: P0-7 pause/resume (pause for 1–3 periods, no charges while paused, anchor shifts by the pause length; pausing in trial is rejected)

Done 2026-10-01: **P0-5 proration** (D-006). `changePlan(actor, subId, toPlanId, asOf)` in `src/subscriptions/plan-change.ts`; pure `prorationLines()` and `prorateCents()` (half-up, `money.ts`) with hand-calculated fixtures in `tests/unit/money.test.ts`. The downgrade credit is `Subscription.creditCents`, used by `invoiceFor()` in `billing-run.ts` (shared with dunning) and taken off the balance in `advancePeriod()`.

Carry into P0-7:
- The anchor shift touches `billingAnchor`, which billing dates are counted from (`period.ts`, D-003). Write it as a Subscription write in `transition.ts` (single-writer test). The state machine already has paused/resume edges: check `state.ts`.
- `changePlan` rejects a paused subscription (only trialing/active can change), and the billing run skips paused ones.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, and check that `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty. `git checkout prisma/migrations/migration_lock.toml` before committing.
