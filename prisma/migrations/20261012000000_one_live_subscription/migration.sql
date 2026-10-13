-- D-025 (review 2026-10-12): a member has at most one subscription per org that is not cancelled. `subscribe`
-- counted and then created, so two requests at once made two live rows, both charged, the older one unreachable.
-- Prisma cannot declare a partial index, so it lives here only. Fails here if any member already has two live rows.
CREATE UNIQUE INDEX "Subscription_one_live_per_member" ON "Subscription"("orgId", "userId") WHERE "status" <> 'cancelled';
