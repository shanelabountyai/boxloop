# BoxLoop release notes

Learning project, local only, mock payments. Status: closed (2026-10-02). All four closure deliverables done.

## Closure deliverables

| Deliverable | Where |
|---|---|
| Demo script | `docs/DEMO.md` (every command run once on 2026-10-02) |
| Cost review | `docs/DECISIONS.md` D-014 |
| Exec brief | BoxLoop in Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (version 2, 2026-10-03: styled screenshots of `/o/sim/metrics`, `/o/sim/plans` and one subscriber detail page, captured at 1280px light after `seed:demo` + `simulate`; the "what this is not" list now says the screens are a first design pass, and the decision count reads 23) |
| LinkedIn posts | Ledger posts 94 (Impact, churn vs failed cards) and 95 (MarTech, discounted downgrade credit), project `boxloop`: https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i |

## After closure (2026-10-02)

Four review passes; decisions in `docs/DECISIONS.md`.

- `/code-review high` on `src/subscriptions/`: racing-write guards, pause day drift, charge at signup (D-015), MRR excludes never-paid (D-016).
- Security review (org scoping): a subscription's plan must be in its own org, enforced by a composite FK (D-017).
- Testing-strategy pass: mock provider replays keys like a real one (D-018); D-019 to D-021 lock current behaviour. Suite 321/321, 43 files.
- Ponytail audit: shared `lostRace`, `iso`, `daysBetween`, `ratioBps`/`formatBps`.

Build log entry updated: status shipped, with repo, brief and demo links. No technical write-up (`WRITEUP.md`) exists yet.

Design pass 1 (2026-10-02, a505fa7): `docs/DESIGN_BRIEF.md` implemented as one `globals.css` plus the header, home, member subscription page, operator subscribers list and detail, and 404 (D-022, D-023). Gate: vitest 321/321, e2e 11/11, foundation:drift clean.
