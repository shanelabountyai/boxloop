# NEXT

## ▶ Next session here: P0-6 dunning sequence (retry on days 1, 3 and 7, notify through the outbox at each, cancel on day 10)

Done 2026-10-01: **P0-4 daily billing run** (D-004). `npm run billing:run -- --date=YYYY-MM-DD` runs `runBilling(asOf, charge)` in `src/subscriptions/billing-run.ts` and prints `{attempted, succeeded, failed, skipped}`. `ChargeAttempt` has the unique key `(subscriptionId, periodStart, attempt)`. `advancePeriod()` sits in `transition.ts`, so all Subscription writes are still in one file.

Carry into P0-6:
- **Where dunning starts:** a `past_due` subscription whose unpaid period is `nextBillingDate`. The day-0 failure is the `ChargeAttempt` with `attempt = 1, outcome = failed` and its `attemptedOn`. Retries are attempts 2, 3 and 4, on attemptedOn + 1, 3 and 7. Reuse the `Charger` type and the idempotency key format `subId:periodStart:attempt`.
- On a successful retry: `advancePeriod` plus `transition('payment_recovered')`, in one transaction, as the run does. On day 10: `transition('dunning_exhausted')`.
- `mockCharger` approves everything. P0-6 needs a mock payment method that can decline (PRD: "member updating their mock payment method triggers an immediate retry"). Any column it adds to Subscription has to be written from `transition.ts`, or the single-writer test fails.
- `runBilling` charges at most one period per subscription per run, and an unexpected error stops the run. A rerun resumes safely.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, and check that `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty. `git checkout prisma/migrations/migration_lock.toml` before committing. `BACKLOG.md`/`IMPLEMENTATION_PLAN.md` are still the template's.
