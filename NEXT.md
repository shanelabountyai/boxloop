# NEXT

## ▶ Next session here: P0-3 billing cycle engine. First, decide the PRD's open question: injected clock vs `--date`

Done 2026-10-01: **P0-2 subscription state machine**. `src/subscriptions/state.ts` is the pure table (`next()`, `InvalidTransition`, `diagram()`), and `src/subscriptions/transition.ts` is the only writer of `Subscription.status`: it validates, does an optimistic `updateMany` on the old status (`StaleTransition` on a race), and audits `subscription.<event>` `{from,to}` into `AuditEvent` in the same transaction. Diagram is in `docs/STATE_MACHINE.md` (a test checks it against the table). Two extra edges are D-002. Gate: 214 tests green, typecheck passes, drift clean.

Carry into later items:
- **P0-3 open question (blocking):** `src/core/clock.ts` (`now()` + `advanceClock`) already exists, which leans toward an injected clock. Ask before building.
- `Subscription` has no period columns yet; P0-3 adds `currentPeriodStart/End`, `nextBillingDate` and the anchor day. Initial status at signup: `trialing` if `plan.trialDays > 0`, otherwise `active` (the diagram has both start edges).
- Signup (P0-3) must offer only plans with `archivedAt: null`.
- `prisma migrate dev` does NOT regenerate the client in Prisma 7: run `npm run db:generate` after it. It also rewrites the template-owned `migration_lock.toml`: `git checkout` that file before committing.
- `prisma migrate reset --force` fails quietly here. To redo an unpushed migration, drop its objects and its `_prisma_migrations` row by hand.
- The harness reseeds between calls: new `ref('<model>')` fixtures in `tests/fixtures/app.ts` need fixed ids.
- `BACKLOG.md`/`IMPLEMENTATION_PLAN.md` are still the template's.
