-- A subscription's plan belongs to the subscription's own org (security review 2026-10-02). signup and
-- changePlan already scope the plan to the org; this makes the database refuse it too, because the global
-- billing run charges `sub.plan.priceCents` without re-checking the org. Fails here if any row already crosses orgs.

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Plan_id_orgId_key" ON "Plan"("id", "orgId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_orgId_fkey" FOREIGN KEY ("planId", "orgId") REFERENCES "Plan"("id", "orgId") ON DELETE NO ACTION ON UPDATE CASCADE;
