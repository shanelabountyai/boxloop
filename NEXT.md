# NEXT

BoxLoop is deployed (D-024) at https://boxloop.labintelligence.co, see `docs/RELEASE_NOTES.md`. Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (v4, live-demo chip and honesty line, 2026-10-04). Nothing is queued except:

1. Record the Neon compute baseline after a week (~2026-10-11; command in the release notes).
2. (done 2026-10-04) e2e 11/11 after the `seed:demo` change. It first failed 9/11 with 401s: `.env.local` now carries `DEMO_ACCESS_PASSWORD`, which the tests inherit. `.env.test` (gitignored) now blanks it; a fresh clone needs the same line.
