# NEXT

## ▶ Next session here: the 180-day `simulate` command (PRD Phase 4, Success Metrics): advance a virtual clock day by day for 180 days, running billing and dunning each day against ~50 seeded members with scripted behaviours (trials, upgrades, payment failures, pauses, cancellations), and print a reconciled summary.

Done 2026-10-01: **P0-8 cancellation** (D-008), so every P0 item is built. Cancel is `transition(actor, id, 'cancel')`; `runBilling()` ends due cancellations in the same `sweep()` that resumes pauses; `undoCancel(actor, subId, asOf)` is in `src/subscriptions/cancel.ts`. A paused member cannot cancel (restore path in D-008).
Also added: `docs/DESIGN_BRIEF.md`, the input for a Claude Design pass (no UI beyond `/o/[org]/plans` exists yet; member and operator screens are designed there, to build after).

Carry into simulate:
- Both jobs take the date: `runBilling(asOf)` then `runDunning(asOf)` per day (check the order `scripts/billing-run.ts` uses). The scripted behaviours call `changePlan`, `pause`, `transition(..., 'cancel')`, `undoCancel` and `updateCard` with that day's `asOf`.
- The success metrics to print: 0 duplicate charges, dunning recovery rate, and MRR by month (to check later against a spreadsheet).
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
