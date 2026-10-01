# NEXT

## ▶ Next session here: P1-1 metrics dashboard (PRD): MRR, active count, trial-conversion %, voluntary vs involuntary churn, **derived from the audit-event stream**, not current state. Check it against `npm run simulate`: its MRR by month end ($555 / $1,150 / $1,085 / $1,050 / $1,115 / $1,115) is the expected answer for the `sim` org.

Done 2026-10-01: **the 180-day `simulate` command** (D-009). `npm run simulate` runs in about 2s and prints 0 duplicates, a reconciled $6,234.41, and a dunning recovery of 10/15 (66.67%). `tests/integration/simulate.test.ts` locks the hand tally.

Carry forward:
- The PRD's "MRR matches an independent spreadsheet" check is still open. The Jan 31 figure is hand-checked in the test; the other months are snapshotted, not independently checked. A CSV export from the sim would feed the spreadsheet if it is wanted.
- The sim needs no subscriptions outside org `sim` in the database it runs on, because the billing run is global.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
