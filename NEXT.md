# NEXT

## ▶ Next session here: optional only. Project is closed and reviewed. Pick one or stop.
- `ponytail-audit` (Sonnet).
- Feature candidate: an operator login for the `sim` org so the metrics page has data in the demo.

Done 2026-10-02: testing-strategy pass. Added 7 tests (lost-write replay, provider throw, yearly renewal + pause, billing-day refusal, late card fix, every-anchor period sweep). Found and fixed: a declined upgrade's key replayed the decline forever, so the mock now replays keys like a real provider (D-018). Locked current behaviour as D-019 (yearly pause = years), D-020 (billing day before the run refuses plan change/pause), D-021 (card fixed after day 10 still recovers). Full suite 321/321 (43 files), EXIT=0.

Done 2026-10-02: security review (org scoping). No exploitable issue: org pages and actions all go through `requireOrg` + `inOrg`; subscription writers are reachable only from CLI scripts and scope by `actor.orgId`. Hardened with a composite FK so a subscription's plan must be in its own org (D-017, migration `20261002100000_plan_same_org`, test in `tests/integration/plans.test.ts`). Template-owned paths (auth, webhook, share links) were not reviewed here.

Done 2026-10-02: `/code-review high` on `src/subscriptions/` (commits 3121f57 and the next one). Fixed: racing writes (advancePeriod/switchPlan status guards, InvalidTransition no longer aborts a run), pause day drift (D-007), charge-at-signup (D-015), MRR excludes never-paid (D-016). Not changed, by design: charge-before-record (D-004), per-line proration rounding (D-006), one period per run (ponytail note), updateCard has no per-day cap (mock only). Sim and mrr:check numbers unchanged.

Closure done 2026-10-02: `docs/DEMO.md`, cost review (D-014), BoxLoop in Brief, Ledger posts #94/#95. URLs in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- Brief screenshots came from `/o/sim/metrics` and `/o/sim/plans` with owner@acme temporarily made an owner of `sim` (psql insert, removed after).
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
