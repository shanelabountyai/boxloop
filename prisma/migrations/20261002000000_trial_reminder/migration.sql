-- P1-3: the trial-ending reminder. One row per subscription; its primary key is what makes a rerun a no-op.
CREATE TABLE "TrialReminder" (
    "subscriptionId" UUID NOT NULL,
    "trialEndsOn" DATE NOT NULL,
    "queuedOn" DATE NOT NULL,

    CONSTRAINT "TrialReminder_pkey" PRIMARY KEY ("subscriptionId"),
    CONSTRAINT "TrialReminder_before_conversion" CHECK ("queuedOn" < "trialEndsOn")
);

ALTER TABLE "TrialReminder" ADD CONSTRAINT "TrialReminder_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
