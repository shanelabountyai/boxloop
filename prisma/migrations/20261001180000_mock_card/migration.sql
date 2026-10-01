-- P0-6: the mock payment method a member can update; `declines` makes every charge fail.
CREATE TYPE "MockCard" AS ENUM ('approves', 'declines');

ALTER TABLE "Subscription" ADD COLUMN "card" "MockCard" NOT NULL DEFAULT 'approves';
