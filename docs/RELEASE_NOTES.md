# BoxLoop release notes

Learning project, local only, mock payments. Status: closed (2026-10-02). All four closure deliverables done.

## Closure deliverables

| Deliverable | Where |
|---|---|
| Demo script | `docs/DEMO.md` (every command run once on 2026-10-02) |
| Cost review | `docs/DECISIONS.md` D-014 |
| Exec brief | BoxLoop in Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (version 3, 2026-10-03: the same three screenshots recaptured after the screenshot pass, month labels and an outlined *Archive*, cropped to `main`; version 2, 2026-10-03: styled screenshots of `/o/sim/metrics`, `/o/sim/plans` and one subscriber detail page, captured at 1280px light after `seed:demo` + `simulate`; the "what this is not" list now says the screens are a first design pass, and the decision count reads 23) |
| LinkedIn posts | Ledger posts 94 (Impact, churn vs failed cards) and 95 (MarTech, discounted downgrade credit), project `boxloop`: https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i |

## After closure (2026-10-02)

Four review passes; decisions in `docs/DECISIONS.md`.

- `/code-review high` on `src/subscriptions/`: racing-write guards, pause day drift, charge at signup (D-015), MRR excludes never-paid (D-016).
- Security review (org scoping): a subscription's plan must be in its own org, enforced by a composite FK (D-017).
- Testing-strategy pass: mock provider replays keys like a real one (D-018); D-019 to D-021 lock current behaviour. Suite 321/321, 43 files.
- Ponytail audit: shared `lostRace`, `iso`, `daysBetween`, `ratioBps`/`formatBps`.

Build log entry updated: status shipped, with repo, brief and demo links. No technical write-up (`WRITEUP.md`) exists yet.

Design pass 1 (2026-10-02, a505fa7): `docs/DESIGN_BRIEF.md` implemented as one `globals.css` plus the header, home, member subscription page, operator subscribers list and detail, and 404 (D-022, D-023). Gate: vitest 321/321, e2e 11/11, foundation:drift clean.

Screenshot pass (2026-10-03): 27 screens × 360/1280 × light/dark against the production build, with one member in each subscription state built through the real billing functions. No horizontal scroll anywhere at 360. Fixed: failed-retry rows pushed the amount under the date; a cancelled card ended in an empty divider; Metrics bar labels were ISO dates that wrapped and lifted their bars off the baseline (now "Jan"…"Oct"); *Archive* on Plans was a primary button (now outlined); the home pill row lacked *Paused*. Left as is: an admin opening the template's `/settings/billing` gets the template's generic error page (owner-only permission, template-owned); inline text links (footer, "← Subscribers", the onboarding org list) are under 44px tall, which WCAG 2.5.8 exempts for inline links.

## Deployed (2026-10-04, D-024)

Live at **https://boxloop.labintelligence.co** behind a shared password (HTTP Basic, any username; `DEMO_ACCESS_PASSWORD`, gate in `src/proxy.ts` + `src/subscriptions/demo-gate.ts`). Vercel project `boxloop` (Root Directory `.`, git connected), Neon `boxloop` (`misty-snow-08399765`, us-east-2), Cloudflare A record `76.76.21.21`, DNS-only. Production holds the seeded demo orgs plus the 180-day sim (37 active, 13 cancelled); no cron. Smoke: gate 401/401/200, `/api/health` ok, owner@acme at `/o/sim/metrics` shows $1,115.00. Open gap: member@acme (org `acme`) sees "No plans are open for signup yet", so a visitor cannot subscribe there; the sim org has the plans.

Cost review addendum (D-014): baseline $0 before; now Neon compute (autosuspend default) and Vercel builds only. Record Neon `compute_time_seconds` via `neonctl projects get misty-snow-08399765 --org-id org-morning-smoke-06224724` after a week.
