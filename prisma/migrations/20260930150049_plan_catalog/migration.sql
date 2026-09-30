-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('month', 'year');

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plan_orgId_idx" ON "Plan"("orgId");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money and trial bounds (P0-1).
ALTER TABLE "Plan" ADD CONSTRAINT "plan_price_nonnegative" CHECK ("priceCents" >= 0);
ALTER TABLE "Plan" ADD CONSTRAINT "plan_trial_days_range" CHECK ("trialDays" BETWEEN 0 AND 365);

-- Grandfathering (D-001): a plan's price terms never change once written. New price ⇒ new plan.
CREATE FUNCTION plan_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."priceCents" <> OLD."priceCents" OR NEW."interval" <> OLD."interval" OR NEW."trialDays" <> OLD."trialDays" THEN
    RAISE EXCEPTION 'plan_terms_immutable: price, interval and trial are fixed; create a new plan';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER plan_terms_immutable BEFORE UPDATE ON "Plan" FOR EACH ROW EXECUTE FUNCTION plan_terms_immutable();
