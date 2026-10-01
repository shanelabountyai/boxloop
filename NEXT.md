# NEXT

## ▶ Next session here: P1-3 trial-ending reminder (PRD): an outbox notification 3 days before conversion. It must be idempotent across repeated billing runs, as charges are. Decide whether it is sent from the billing run or from its own sweep.

Done 2026-10-01: **P1-2 coupons** (D-011). A coupon is a percent off the next N paid invoices and comes off before credit. It survives a plan change, and proration prices both plans at the paid period's discount (`paidOffBps`). Tests: `tests/integration/coupon.test.ts` and the `coupons` block in `tests/unit/money.test.ts`.

Carry forward:
- Coupons have no UI and no code catalog; `applyCoupon()` is domain-only, like `changePlan()`. MRR is still at list price (D-011 says how to make it net).
- The full vitest sweep timed out once in `tests/invariants/inv-01-04-22-actions.test.ts` (180s), and its controls then failed with an org-create conflict. The file passes alone in 3.5s, and another project's test DB was active at the time. Watch for it in the next sweep.
- The PRD's "MRR matches an independent spreadsheet" check is still open (see D-010).
- The sim needs no subscriptions outside org `sim` in the database it runs on, because the billing run is global.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
