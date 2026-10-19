# NEXT

BoxLoop is deployed (D-024) at https://boxloop.labintelligence.co, see `docs/RELEASE_NOTES.md`. Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (v4, live-demo chip and honesty line, 2026-10-04). Nothing is queued except:

1. Record the Neon compute baseline after a week (~2026-10-11; command in the release notes).
2. (done 2026-10-04) e2e 11/11 after the `seed:demo` change. It first failed 9/11 with 401s: `.env.local` now carries `DEMO_ACCESS_PASSWORD`, which the tests inherit. `.env.test` (gitignored) now blanks it; a fresh clone needs the same line.

**2026-10-19:** saas-foundation v1.3.0 (`security:` INV-22, INV-28; `scorekeeper` role, migration `20261014000000_role_scorekeeper`) is merged on branch `foundation-v1.3.0`, awaiting review and merge (due 2026-10-21). After merge: `npm run db:migrate` locally and on Neon, then update boxloop's row in the template's `CLONES.md`.
