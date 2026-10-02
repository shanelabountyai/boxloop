# BoxLoop demo script

About 10 minutes. BoxLoop is subscription billing: plans, trials, proration, dunning, and a billing run you can re-run without double-charging. Everything runs locally against a mock card provider. Nothing is deployed.

Every command below was run once on 2026-10-02 (321/321 tests, typecheck clean). Output numbers are the real ones.

## Before you start

```bash
cd ~/Projects/boxloop
pg_isready                 # expect: /tmp:5432 - accepting connections
npm run seed:demo          # idempotent; creates the Acme and Globex demo orgs
```

The `.env.local` it reads must have `DEMO_MODE=1` and a local `DATABASE_URL` (`grep -E '^(DEMO_MODE|DATABASE_URL)=' .env.local`). The app refuses a cloud database on purpose.

Do **not** start `npm run dev` for the CLI half (screens 1–4). It is only needed for screen 5 (port 4800).

## Accounts

No password: `/demo` signs in with one click when `DEMO_MODE=1`.

| Account | Role | Where the credential lives |
|---|---|---|
| owner@acme.demo.test | owner of Acme Studio; admin of `sim` after `simulate` | none needed; TOTP secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` is public by design and printed by `seed:demo` |
| admin@acme.demo.test | admin | same |
| member@acme.demo.test | member | none |
| the same three at globex.demo.test | Globex Labs | same |

## Screen 1 — The whole story in one command (3 min)

```bash
npm run simulate
```

Takes under a minute. It runs the real billing code day by day for 180 days (2026-01-01 → 2026-06-29) over 50 scripted members in 10 behaviour cohorts, then prints a report.

Stop on these lines:

- **"Same-day reruns that charged anything: 0"** and **"Duplicate charges: 0 in the ledger, 0 at the provider"**. Say: every charge has a database key, so running billing twice cannot charge twice.
- **"Collected: $6,234.41 recorded, $6,234.41 charged — reconciled"**. Our ledger and the provider's tally agree to the cent.
- **"Dunning recovery: 10 of 15 failed renewals recovered (66.67%), 5 cancelled"**. This is the cohort design paying off: cohort 5 fixes their card, cohort 4 never does.
- The MRR table. $555.00 in January up to $1,115.00 in June.

The exit code is the point: `echo $?` after it prints `0`. If a metric breaks, the command exits 1.

## Screen 2 — Proving the MRR number (2 min)

```bash
npm run mrr:check
```

Needs `npm run simulate` first (screen 1). It builds a LibreOffice formula sheet from the raw audit events, with no BoxLoop code involved in the arithmetic, and compares it to the app's own `replay()`.

Expect five rows ending `ok`, then "Every month end matches." Say: the MRR the app reports and a spreadsheet built independently agree at every month end. Sheet is at `out/mrr-check/sheet.csv` (gitignored).

## Screen 3 — One billing run, by hand (1 min)

```bash
npm run billing:run -- --date=2026-07-01
```

Prints one JSON line: `{"date":"2026-07-01","attempted":4,"succeeded":4,...,"dunning":{...}}`. Run it twice. The second run reports `attempted: 0`. Say: the date is a parameter, never read from a clock, so any day can be replayed.

A bad date fails fast: `npm run billing:run -- --date=notadate` prints `--date must be a real YYYY-MM-DD` and exits 2.

This run leaves charges in the local database. `npm run simulate` wipes and reseeds, so run it again before screen 2 if you did this first.

## Screen 4 — The safety net (2 min)

```bash
npm test
```

About 30 seconds, 43 files, 321 tests. Point to three files:

- `tests/integration/billing-run.test.ts`: idempotency, including racing runs.
- `tests/integration/plan-change.test.ts`: proration checked against hand-calculated cents.
- `tests/integration/subscription-transition.test.ts`: every legal transition, plus the rejections.

The status table is in `docs/STATE_MACHINE.md`. A test fails if any code other than `transition()` writes a subscription's status.

## Screen 5 — The UI (4 min)

```bash
npm run dev        # http://localhost:4800
```

1. Open http://localhost:4800/demo and click **owner@acme.demo.test**.
2. Go to **/o/acme/plans**. Create a plan (for example Starter, $10.00 monthly, 14-day trial). Say: price terms are locked once created; a database trigger refuses edits, so repricing means a new plan.
3. Open **/o/acme/metrics** (owner and admin only). It shows "No subscriptions yet" for a fresh org.
4. Open **/o/sim/metrics**. This is screen 1's simulation on the dashboard: the same month-end MRR (from $555.00 in January to $1,115.00), 88.37% trial conversion and churn. Rows after June stay flat, because the sim stops there and the table runs on to today. `simulate` makes owner@acme an admin of `sim` each time it reseeds, so run `seed:demo` before `simulate`.

5. In a private window, open /demo and click **member@acme.demo.test**, then **Acme Studio**. The org opens on **My subscription**, which shows the plan picker. Say: a trial plan says when the first charge falls; a no-trial plan says "You'll be charged $X today" (D-015). Tick *the mock provider declines this payment* on a no-trial plan to show that a decline creates nothing.
6. Start the trial. The card shows the status pill and the dates line: "Trial ends …, then $10.00/month". Open **Change plan** to show the preview before confirming, then **Cancel trial**: "Your trial ends now, nothing was charged."
7. Back as owner@acme, open **Subscribers** and click the member. Say: the operator view is read-only, and the audit timeline names who made each change (member, operator or System) with from → to.

Stop the dev server when done (`lsof -ti :4800 | xargs kill`).

## What to concede before you're asked

- **The dashboard's data is the simulation, not live traffic.** `/o/sim/metrics` charts the 180-day sim; the proof of the numbers is screens 1 and 2, not the chart.
- **Card entry is a toggle.** The member screens cover signup, plan change, pause, cancel and undo, and "update payment method" chooses a mock card that approves or declines. Coupons are CLI-only.
- **A paused or past-due member cannot cancel from the UI**, because the state machine has no edge for it (D-008, D-023).
- **The payment provider is a mock.** No Stripe account, no real card. The sim scripts its declines.
- **MRR is at list price.** Coupons are not netted out (D-011 says how).
- **Trial reminders use the generic notice email template**, because the templates belong to the foundation.
- **Synthetic data, nothing deployed.** It is a learning project; the 50 members are generated.
- **The simulation needs the subscriptions table to itself**, because the billing run is global.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `simulate` throws "N subscriptions exist outside the sim" | other subscriptions in the `boxloop` database | clear them; `simulate` only deletes its own `sim` org |
| `mrr:check` fails or finds no events | `simulate` has not run, or it was wiped | `npm run simulate` first |
| `/demo` returns 404 | `DEMO_MODE` is not 1 in `.env.local` | set `DEMO_MODE=1`, restart the server |
| `/demo` says "No demo users yet" | seed not run | `npm run seed:demo` |
| Seed or app refuses to start, mentions cloud | `DATABASE_URL` is not local | point it at local `boxloop`; never set `ALLOW_CLOUD_DB` for this |
| Port 4800 already in use | an old dev server | `lsof -ti :4800 \| xargs kill` |
| Many failures within seconds in `npm test` | memory pressure or no local Postgres | `sysctl -n kern.memorystatus_level`, `pg_isready` |
