# NEXT

## ▶ Next session here: refresh the BoxLoop in Brief screenshots with the styled UI (optional), or nothing: the design pass is done.

Done 2026-10-02: design pass 1 implemented from Claude Design project `25b0df2e-3469-4bac-90f5-82ff943d3803` (BoxLoop Design.dc.html). `src/app/globals.css` (tokens, light/dark, element styles) styles the template pages unedited. New: header + org nav, home, `/o/[org]/subscription` (picker, card, confirm previews, history), `/o/[org]/subscribers` and `/subscribers/[id]` (read-only, audit timeline), not-found; plans and metrics restyled. D-022 (one stylesheet, `<details>` confirms with no client JS), D-023 (only state-machine actions; no Cancel on paused/past_due; resubscribe = picker under an ended card; member actions take no subscription id). The design board's open questions (Resume, Resubscribe, Metrics in the header) were defaulted in D-023. Gate: vitest 321/321, e2e 11/11 (new `e2e/subscription.spec.ts`), foundation:drift clean, 360/1280 screenshots in both themes with no overflow. The brief's screenshots predate the styling.

Done 2026-10-02: the demo can now reach the sim's dashboard. `simulate` makes seed:demo's owner@acme an admin of `sim` after each reseed, so `/o/sim/metrics` charts the 180-day run (DEMO.md screen 5 step 4). No new isDemo user, so INV-27's "only seed-demo sets isDemo" still holds. Checked in the real app.

Done 2026-10-02: ponytail-audit, applied in the next commit except plan-change.ts's P2002 catch, which rethrows as StaleTransition rather than skipping, so it stays. Net line count is about even: the new helpers carry doc comments. Suite 321/321. The project's own code (~1.3k lines) is lean, with no dependencies to cut. Shrinks:
1. Lost-race catch `code !== 'P2002' && !(StaleTransition || InvalidTransition)` is repeated in billing-run.ts and dunning.ts (x2). Make it one `lostRace(e)` in transition.ts.
2. `iso` is defined 3 times (billing-run, dunning, simulate) and `.toISOString().slice(0, 10)` is inlined about 10 more. Export one `iso` from period.ts.
3. `DAY_MS` is redefined in pause.ts and plan-change.ts. Export `daysBetween(a, b)` from period.ts.
4. Half-up ratio `floor((n*20000+d)/(2d))` is in trialConversionBps and simulate's recoveryRateBps, and `pct` is in the metrics page and simulate report. Add `ratioBps` and `formatBps` to money.ts.
5. `sequence(sub)` is computed in runDunning and again in retry. Pass it in.
6. Drop `export` from TRIAL_REMINDER_DAYS, RETRY_DAYS, CANCEL_DAY and Interval, which are used only in their own files.
Out of scope (template-owned, cut upstream if anywhere): spikes/, audit/, OLD_DO_NOT_USE_FOUNDATION_SPEC.drizzle-draft.md.

Done 2026-10-02: testing-strategy pass. Added 7 tests (lost-write replay, provider throw, yearly renewal + pause, billing-day refusal, late card fix, every-anchor period sweep). Found and fixed: a declined upgrade's key replayed the decline forever, so the mock now replays keys like a real provider (D-018). Locked current behaviour as D-019 (yearly pause = years), D-020 (billing day before the run refuses plan change/pause), D-021 (card fixed after day 10 still recovers). Full suite 321/321 (43 files), EXIT=0.

Done 2026-10-02: security review (org scoping). No exploitable issue: org pages and actions all go through `requireOrg` + `inOrg`; subscription writers are reachable only from CLI scripts and scope by `actor.orgId`. Hardened with a composite FK so a subscription's plan must be in its own org (D-017, migration `20261002100000_plan_same_org`, test in `tests/integration/plans.test.ts`). Template-owned paths (auth, webhook, share links) were not reviewed here.

Done 2026-10-02: `/code-review high` on `src/subscriptions/` (commits 3121f57 and the next one). Fixed: racing writes (advancePeriod/switchPlan status guards, InvalidTransition no longer aborts a run), pause day drift (D-007), charge-at-signup (D-015), MRR excludes never-paid (D-016). Not changed, by design: charge-before-record (D-004), per-line proration rounding (D-006), one period per run (ponytail note), updateCard has no per-day cap (mock only). Sim and mrr:check numbers unchanged.

Closure done 2026-10-02: `docs/DEMO.md`, cost review (D-014), BoxLoop in Brief, Ledger posts #94/#95. URLs in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- Brief screenshots came from `/o/sim/metrics` and `/o/sim/plans` (owner@acme now reaches them through `simulate`, so no psql insert is needed).
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
