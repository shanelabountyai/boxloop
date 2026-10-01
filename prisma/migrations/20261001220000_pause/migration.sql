-- P0-7: pause/resume. The day a pause ends, set exactly while the subscription is paused.
ALTER TABLE "Subscription" ADD COLUMN "pausedUntil" DATE,
    ADD CONSTRAINT "Subscription_paused_until" CHECK (("status" = 'paused') = ("pausedUntil" IS NOT NULL));
