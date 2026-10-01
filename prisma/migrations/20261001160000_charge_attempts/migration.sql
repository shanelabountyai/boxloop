-- P0-4: charge attempts. The unique key (subscription, period, attempt) is the billing run's idempotency key.
CREATE TYPE "ChargeOutcome" AS ENUM ('succeeded', 'failed');

CREATE TABLE "ChargeAttempt" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "attempt" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "outcome" "ChargeOutcome" NOT NULL,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "attemptedOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChargeAttempt_amount_nonneg" CHECK ("amountCents" >= 0),
    CONSTRAINT "ChargeAttempt_attempt_pos" CHECK ("attempt" >= 1)
);

CREATE UNIQUE INDEX "ChargeAttempt_subscriptionId_periodStart_attempt_key" ON "ChargeAttempt"("subscriptionId", "periodStart", "attempt");

ALTER TABLE "ChargeAttempt" ADD CONSTRAINT "ChargeAttempt_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
