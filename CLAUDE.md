# BoxLoop — subscription & membership billing

PRD: `docs/PRD.md`. Learning project: state machines, proration, dunning, idempotent billing runs. Mock payment provider only; not deployed.

## Stack
- Clone of saas foundation **v1.2.0**, port **4800**. Template-owned paths are never edited here.
- Money: `Int` cents named `...Cents`, rates in basis points `...Bps`. No floats, no `Decimal`.
- Time is passed in: billing code takes `asOf` as a parameter and never reads a clock; only a command's entry point defaults it to `now()` (D-003). Dates are calendar days, and period math lives in `src/subscriptions/period.ts`.
- Local Postgres only (`boxloop`, `boxloop_test`); tests never point at a remote DB.
- Subscription status changes only through `transition()` (`src/subscriptions/transition.ts`); the table in `src/subscriptions/state.ts` is the single source of truth, diagrammed in `docs/STATE_MACHINE.md`. A test fails on any other writer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
