-- P1-2: coupons. A percent-off for N paid periods on the subscription, the discount the current period was paid at
-- (proration uses it), and the discount each invoice and plan change applied.
ALTER TABLE "Subscription" ADD COLUMN "couponOffBps" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "couponPeriodsLeft" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "paidOffBps" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "Subscription_coupon_range" CHECK ("couponOffBps" BETWEEN 0 AND 10000 AND "couponPeriodsLeft" >= 0 AND "paidOffBps" BETWEEN 0 AND 10000);

ALTER TABLE "ChargeAttempt" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "ChargeAttempt_discount_nonneg" CHECK ("discountCents" >= 0);

ALTER TABLE "PlanChange" ADD COLUMN "discountBps" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "PlanChange_discount_range" CHECK ("discountBps" BETWEEN 0 AND 10000);
