# BoxLoop decisions

| Id | Decision | Why |
|---|---|---|
| D-001 | **A plan's price terms (`priceCents`, `interval`, `trialDays`) are fixed at creation.** Only the name is editable; repricing means creating a new plan and archiving the old one. A `BEFORE UPDATE` trigger (`plan_terms_immutable`, migration `20260930150049_plan_catalog`) enforces it, along with CHECKs `priceCents >= 0` and `trialDays` 0–365. Operators are `org.update` holders (owner, admin), since the template's permission list is template-owned. *Default taken 2026-09-30 (P0-1).* | Grandfathering (P0-1) falls out for free: a subscription points at its plan and its price can never move, so no price snapshot is needed on the subscription. Same model as Stripe Prices. Reversible: drop the trigger and add a snapshot column if in-place repricing is ever wanted. |
