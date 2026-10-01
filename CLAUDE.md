# BoxLoop — subscription & membership billing

PRD: `docs/PRD.md`. Learning project: state machines, proration, dunning, idempotent billing runs. Mock payment provider only; not deployed.

## Stack
- Clone of saas foundation **v1.2.0**, port **4800**. Template-owned paths are never edited here.
- Money: `Int` cents named `...Cents`, rates in basis points `...Bps`. No floats, no `Decimal`.
- Time is passed in: billing code takes `asOf` as a parameter and never reads a clock; only a command's entry point defaults it to `now()` (D-003). Dates are calendar days, and period math lives in `src/subscriptions/period.ts`.
- Local Postgres only (`boxloop`, `boxloop_test`); tests never point at a remote DB.
- Subscription status changes only through `transition()` (`src/subscriptions/transition.ts`); the table in `src/subscriptions/state.ts` is the single source of truth, diagrammed in `docs/STATE_MACHINE.md`. A test fails on any other writer.
