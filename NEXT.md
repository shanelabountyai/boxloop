# NEXT

## ▶ Next session here: `/security-review` (org scoping, since the billing run is global). Model: Opus.
Then re-run `npm test`, `npm run simulate`, `npm run mrr:check` if anything changes, and update `docs/DEMO.md` / the brief if a number moves.
After that, optional: `ponytail-audit`, `testing-strategy`. Feature candidate if wanted: an operator login for the `sim` org so the metrics page has data in the demo.

Done 2026-10-02: `/code-review high` on `src/subscriptions/` (commits 3121f57 and the next one). Fixed: racing writes (advancePeriod/switchPlan status guards, InvalidTransition no longer aborts a run), pause day drift (D-007), charge-at-signup (D-015), MRR excludes never-paid (D-016). Not changed, by design: charge-before-record (D-004), per-line proration rounding (D-006), one period per run (ponytail note), updateCard has no per-day cap (mock only). Sim and mrr:check numbers unchanged.

Closure done 2026-10-02: `docs/DEMO.md`, cost review (D-014), BoxLoop in Brief, Ledger posts #94/#95. URLs in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- Brief screenshots came from `/o/sim/metrics` and `/o/sim/plans` with owner@acme temporarily made an owner of `sim` (psql insert, removed after).
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
