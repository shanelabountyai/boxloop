# NEXT

## ▶ Deploy BoxLoop: password-protected demo, cron off (D-024, chosen 2026-10-03)

Follow callboard's deployment as the model: its Vercel project, Neon project, password gate and DNS. Steps:
1. Remove `crons` from `vercel.json`, keep the `ignoreCommand`. Push.
2. Neon project `boxloop` with a pool cap; Vercel project `boxloop`, Root Directory `.`; env vars from `.env.example` (Shane pastes secrets), `DEMO_MODE=1`, and the shared password the way callboard does it.
3. `prisma migrate deploy` against production, then `seed:demo` and `simulate` against production, deliberately (it is demo data, on purpose, like callboard).
4. Cloudflare record `boxloop.labintelligence.co` (DNS-only), domain on the Vercel project.
5. Smoke test: /demo as owner@acme shows `/o/sim/metrics` at $1,115.00; member@acme can subscribe.
6. Update the port-table row in `~/.claude/CLAUDE.md`; replace the brief's "Not deployed" chip and honesty line, then republish; release notes; cost review addendum (Neon compute, builds) in D-014; BUILD LOG UPDATE.

Brief: https://claude.ai/artifact/TEUMAmMnmSvY6xJm9GmDcw (version 3). Other artifact URLs are in `docs/RELEASE_NOTES.md`.

Carry forward:
- Sim needs no subscriptions outside org `sim`. `billing:run` after `simulate` leaves extra charges; rerun `simulate`.
- A brief recapture: `seed:demo`, `simulate`, `next build`, `npm start`, sign in at /demo as owner@acme, screenshot `/o/sim/metrics`, `/o/sim/plans`, `/o/sim/subscribers/<id>` (pick an active sub with a PlanChange; v3 used member-03). Capture `main` at 1280px, 2x, resized to 1400px on the long side; plans is clipped to the last plan card plus *New plan*.
- Hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`; `git checkout prisma/migrations/migration_lock.toml` before committing.
