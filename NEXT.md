# NEXT

## ▶ Next session here: post-closure reviews, in this order (Shane, 2026-10-02). Model: Opus.
1. `/code-review high` on the billing code (`src/subscriptions/`): proration rounding, dunning catch-up, period-advance races, coupon/credit ordering.
2. `/security-review`: org scoping, since the billing run is global.
3. Fix what survives verification, then re-run `npm test`, `npm run simulate`, `npm run mrr:check`, and update `docs/DEMO.md` / the brief if any number changes.
After that, optional: `ponytail-audit`, `testing-strategy`. Feature candidate if wanted: an operator login for the `sim` org so the metrics page has data in the demo.

Closure done 2026-10-02: `docs/DEMO.md`, cost review (D-014), BoxLoop in Brief, Ledger posts #94/#95. URLs in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- Brief screenshots came from `/o/sim/metrics` and `/o/sim/plans` with owner@acme temporarily made an owner of `sim` (psql insert, removed after).
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
