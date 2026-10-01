# NEXT

## ▶ Next session here: P0-4 daily billing run (`billing:run --date`, idempotent, mock provider)

Done 2026-10-01: **P0-3 billing cycle engine**. D-003: time is passed in (`asOf`), never read from a clock in billing code. `src/subscriptions/period.ts` is pure: `shift` (anchor + n intervals, clamped to short months, always counted from the anchor), `periodFrom(anchor, interval, start)`, `signupTerms(plan, asOf)`. `src/subscriptions/signup.ts` persists a signup (unarchived plans in the actor's org only; it audits `subscription.created`). `Subscription` now has `billingAnchor`, `currentPeriodStart/End` (end exclusive, CHECK end > start) and `nextBillingDate` (indexed), all `date`.

Carry into P0-4:
- **Charge rule:** a subscription is due when `nextBillingDate <= asOf`. After a successful charge, the new period is `periodFrom(billingAnchor, interval, nextBillingDate)` and `nextBillingDate` becomes its end. This one step covers trial conversion (`trialing → active` via `convert`) and every renewal. A failed charge sends `payment_failed`.
- Idempotency key per subscription and period: `(subscriptionId, periodStart)` is natural, since `nextBillingDate` is the start of the unpaid period.
- **Single-writer test conflict:** `tests/integration/subscription-transition.test.ts` fails on any `subscription.update*` outside `transition.ts`. Advancing the period columns needs an update, so either route it through `transition.ts` (e.g. an optional `data` for period fields, written with the status in the same `updateMany`) or narrow the test to writes of `status`. Decide this first.
- A signup UI is not built yet; `signup()` is service-level only. The caller must authorise the actor.
- `prisma migrate dev` hung on a shadow-database `DROP` while other projects' sweeps were loading Postgres. Hand-write the SQL and apply it with `npx prisma migrate deploy` + `npm run db:migrate:test`, then check with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` (should be empty). Two orphan `prisma_migrate_shadow_db_*` databases may still exist; drop them once Postgres is quiet.
- Still true: run `npm run db:generate` after a migration; `git checkout prisma/migrations/migration_lock.toml` before committing; fixtures need fixed ids; `BACKLOG.md`/`IMPLEMENTATION_PLAN.md` are still the template's.
