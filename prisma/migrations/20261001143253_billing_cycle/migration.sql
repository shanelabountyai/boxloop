-- P0-3: billing cycle. Calendar-day dates; the table is empty before this item, so no backfill.
ALTER TABLE "Subscription"
  ADD COLUMN "billingAnchor" DATE NOT NULL,
  ADD COLUMN "currentPeriodStart" DATE NOT NULL,
  ADD COLUMN "currentPeriodEnd" DATE NOT NULL,
  ADD COLUMN "nextBillingDate" DATE NOT NULL,
  ADD CONSTRAINT "Subscription_period_order" CHECK ("currentPeriodEnd" > "currentPeriodStart");

-- CreateIndex
CREATE INDEX "Subscription_nextBillingDate_idx" ON "Subscription"("nextBillingDate");
