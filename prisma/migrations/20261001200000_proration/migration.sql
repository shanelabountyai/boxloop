-- P0-5: proration. Plan changes with their line items, a credit balance for downgrades, and the credit each invoice used.
ALTER TABLE "Subscription" ADD COLUMN "creditCents" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "Subscription_credit_nonneg" CHECK ("creditCents" >= 0);

ALTER TABLE "ChargeAttempt" ADD COLUMN "creditAppliedCents" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "ChargeAttempt_credit_nonneg" CHECK ("creditAppliedCents" >= 0);

CREATE TABLE "PlanChange" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromPlanId" UUID NOT NULL,
    "toPlanId" UUID NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "remainingDays" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "creditCents" INTEGER NOT NULL,
    "chargeCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanChange_lines" CHECK ("creditCents" <= 0 AND "chargeCents" >= 0 AND "netCents" = "creditCents" + "chargeCents"),
    CONSTRAINT "PlanChange_days" CHECK ("periodDays" > 0 AND "remainingDays" BETWEEN 0 AND "periodDays"),
    CONSTRAINT "PlanChange_seq_pos" CHECK ("seq" >= 1)
);

CREATE UNIQUE INDEX "PlanChange_subscriptionId_seq_key" ON "PlanChange"("subscriptionId", "seq");

ALTER TABLE "PlanChange" ADD CONSTRAINT "PlanChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
