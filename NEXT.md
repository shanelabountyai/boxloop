# NEXT

## ▶ Next session here: project closure. Every PRD success metric is now closed. Build the four closure deliverables (global CLAUDE.md, *Definition of done*): `docs/DEMO.md` (run every command in it once), the exec brief (`exec-brief` skill), the LinkedIn posts in the Ledger, and the cost review (nothing deployed, so expect a short "nothing bills" record). Record each artifact URL in the repo. P2 is out of scope unless Shane picks one.

Done 2026-10-01: **MRR vs. an independent spreadsheet** (D-013). `npm run mrr:check` after `npm run simulate` builds a LibreOffice formula sheet from the sim's raw audit events and diffs it with `replay()`: 5/5 month ends equal. A mutation (drop `past_due` from MRR) fails 2/5. Also fixed a `tsc` error in `trial-reminder.test.ts` from P1-3.

Earlier: **P1-3 trial-ending reminder** (D-012). `runBilling` queues one outbox email per trialing subscription when conversion is 1–3 days away. A `TrialReminder` row, keyed on the subscription and written in the same transaction, makes reruns and racing runs no-ops. The email quotes the conversion invoice, coupon and credit included. Test: `tests/integration/trial-reminder.test.ts`; a mutation check confirmed the race test fails without the guard. Full sweep: 306/306.

Carry forward:
- Reminders use the generic `notice` template, because the templates are template-owned. Coupons have no UI and no code catalog; `applyCoupon()` is domain-only, like `changePlan()`. MRR is still at list price (D-011 says how to make it net).
- The `inv-01-04-22-actions` timeout seen in the P1-2 sweep did not come back in P1-3's sweep (306/306, 30s). Treat it as contention unless it recurs.
- The sim needs no subscriptions outside org `sim` in the database it runs on, because the billing run is global.
- Still true: hand-write migrations, then `npx prisma migrate deploy` + `npm run db:migrate:test` + `npm run db:generate`, check `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` is empty, and `git checkout prisma/migrations/migration_lock.toml` before committing.
