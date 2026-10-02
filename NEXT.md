# NEXT

## ▶ Next session here: closure, two deliverables left. (1) The exec brief (`exec-brief` skill, match sibling briefs, scope honesty near the top: mock payments, synthetic data, not deployed, no member-facing UI, metrics page unreachable for the sim org). (2) LinkedIn posts in the Ledger (`linkedin-personal-brand-shane` skill; mine the bugs). Record each artifact URL in `docs/RELEASE_NOTES.md`. Then print the BUILD LOG UPDATE block.

Done 2026-10-02: `docs/DEMO.md` (all commands run: simulate, mrr:check, billing:run, seed:demo, test 306/306, typecheck, /demo 200) and the cost review (D-014; hourly cron slowed to daily; $0 recurring).

Carry forward:
- Sim needs no subscriptions outside org `sim`. Running `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
