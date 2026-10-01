# NEXT

## ▶ Next session here: the last open success metric, then closure. The PRD's "MRR matches an independent spreadsheet" check is still open (see D-010). Close it first, then start project closure: `docs/DEMO.md`, the exec brief, the LinkedIn posts, and the cost review (global CLAUDE.md, *Definition of done*). All P0 and P1 items are shipped. P2 is out of scope unless Shane picks one.

Done 2026-10-01: **P1-3 trial-ending reminder** (D-012). `runBilling` queues one outbox email per trialing subscription when conversion is 1–3 days away. A `TrialReminder` row, keyed on the subscription and written in the same transaction, makes reruns and racing runs no-ops. The email quotes the conversion invoice, coupon and credit included. Test: `tests/integration/trial-reminder.test.ts`; a mutation check confirmed the race test fails without the guard. Full sweep: 306/306.

Carry forward:
- Reminders use the generic `notice` template, because the templates are template-owned. Coupons have no UI and no code catalog; `applyCoupon()` is domain-only, like `changePlan()`. MRR is still at list price (D-011 says how to make it net).
- The `inv-01-04-22-actions` timeout seen in the P1-2 sweep did not come back in P1-3's sweep (306/306, 30s). Treat it as contention unless it recurs.
- The sim needs no subscriptions outside org `sim` in the database it runs on, because the billing run is global.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
