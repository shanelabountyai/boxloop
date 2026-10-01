# NEXT

## ▶ Next session here: P1-2 coupons (PRD): percent-off for N periods, and how it interacts with proration (D-006) and the downgrade credit. Decide first whether the discount applies before or after credit, and whether a coupon survives a plan change.

Done 2026-10-01: **P1-1 metrics** (D-010). Metrics are replayed from the `subscription.*` audit stream by business day (`on`). The page is `/o/[org]/metrics`. `npm run simulate` now cross-checks the replayed MRR against the row snapshots and prints trial conversion of 88.37% (38 won, 5 lost) and churn of 3 voluntary and 5 involuntary.

Carry forward:
- The PRD's "MRR matches an independent spreadsheet" check is still open. The Jan 31 figure is hand-checked in the test; every month end is now checked rows against events, but both are this codebase's own derivations. A CSV export from the sim would feed the spreadsheet if it is wanted.
- The sim needs no subscriptions outside org `sim` in the database it runs on, because the billing run is global.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
