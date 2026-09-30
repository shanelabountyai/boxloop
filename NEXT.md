# NEXT

## ▶ Next session here: P0-2 subscription state machine (TDD, pure module first)

Done 2026-09-30: **P0-1 plan catalog**: `Plan` table (`prisma/schema/subscriptions.prisma`), `/o/[org]/plans` create/rename/archive, `src/subscriptions/money.ts` (dollar string → cents, no floats). Price terms immutable by DB trigger (D-001 in `docs/DECISIONS.md`). Gate: 192 tests green, drift clean.

Carry into later items:
- Signup (P0-2/P0-3) must offer only plans with `archivedAt: null`; that is the other half of P0-1's "hidden from signup".
- Decide the PRD's open question **before P0-3**: injected clock vs `--date`. `src/core/clock.ts` (`now()` + `advanceClock`) already exists, which leans toward injected clock.
- `prisma migrate dev` rewrites the template-owned `prisma/migrations/migration_lock.toml` (adds 2 comment lines) → `git checkout` it before commit, or drift fails.
- The harness reseeds between calls: new `ref('<model>')` fixtures in `tests/fixtures/app.ts` need fixed ids.
- `BACKLOG.md`/`IMPLEMENTATION_PLAN.md` are still the template's.
