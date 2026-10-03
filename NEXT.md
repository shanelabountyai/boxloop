# NEXT

## ▶ Nothing queued. BoxLoop is closed: design pass done, brief screenshots refreshed (2026-10-03).

Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (version 2). Other artifact URLs are in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- A brief recapture: `seed:demo`, `simulate`, `next build`, `npm start`, sign in at /demo as owner@acme, screenshot `/o/sim/metrics`, `/o/sim/plans`, `/o/sim/subscribers/<id>` (pick an active sub with a PlanChange).
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
