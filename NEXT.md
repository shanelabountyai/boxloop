# NEXT

## ▶ Next session here: P0-5 proration (mid-period plan change: charge/credit the remaining period, half-up, in cents)

Done 2026-10-01: **P0-6 dunning** (D-005). `runDunning(asOf, charge)` in `src/subscriptions/dunning.ts`, and `billing:run` now prints `{..., dunning: {retried, recovered, cancelled, skipped}}`. `updateCard(actor, subId, card, asOf)` sets the mock card and retries a past_due period at once. `Subscription.card` (`approves`/`declines`) is written only by `setCard()` in `transition.ts`.

Carry into P0-5:
- Read `docs/PRD.md` P0-5. Money math goes in a pure function with hand-calculated fixtures (`src/subscriptions/money.ts` exists). Changing `planId` is a Subscription write, so it lives in `transition.ts` (single-writer test).
- Plans are immutable (D-001): a plan change means pointing the subscription at a different plan. A downgrade credit applies to the next invoice, and there is no invoice/credit table yet.
- Notifications use the `notice` template with `{subject, body}`, since `templates.ts` is template-owned (`npm run foundation:drift`).
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, and check that `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty. `git checkout prisma/migrations/migration_lock.toml` before committing.
