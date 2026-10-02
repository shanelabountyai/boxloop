# BoxLoop: design brief

This is the input for a Claude Design pass. Paste the whole file in. The output is implemented in this repo afterwards.

## The product in one paragraph

BoxLoop is subscription and membership billing for a monthly hobby-supplies box (the same model fits a gym or a
SaaS). An **operator** defines plans (price, monthly or annual, optional free trial). A **member** subscribes, and from
then on BoxLoop runs the billing on its own: a trial converts on its last day, a daily run charges everyone whose
billing date has come, a failed payment is retried on days 1, 3 and 7 and cancelled on day 10, a mid-period plan
change is prorated to the day, a pause skips 1–3 billing periods, and a cancellation keeps access until the paid-through
date. Payments go through a mock provider and all data is synthetic. This is a portfolio demo and is not deployed.

**The design has one job: make the subscription's state and its dates legible.** Every screen that shows a
subscription should answer at a glance *what state it is in*, *what has been paid for, up to when*, and *what happens
next, on which date, for how much* ("Renews Nov 14 for $30.00", "Ends Nov 14, nothing more will be charged",
"Retry 2 of 3 on Oct 4"). Billing is trusted when nothing about it is a surprise.

## Who uses it

| Person | Where they live | What they need to see first |
|---|---|---|
| Member | `/o/[org]/subscription` (to build) | My state, paid-through date, next charge (date and amount), the one or two things I can do now |
| Operator (owner/admin) | `/o/[org]/plans` (built), `/o/[org]/subscribers` (to build) | Who is past due and when they retry, who is ending, what each member was charged and why |

The member is a `member` of the operator's org; the operator is its `owner` or `admin`.

## Screens to design (priority order)

0. **A signed-in header (global nav).** There is no nav today, and the home page `<h1>` and `<title>` still say
   "SaaS Foundation". One header for the root layout: wordmark → `/`, *My subscription* for a member, *Plans* and
   *Subscribers* for an operator, *Account*, *Sign out*. It must work at 360px. Sign-in lands on the template's
   `/onboarding` page, which is template-owned and stays, so the header is the way out.
1. **Member subscription (`/o/[org]/subscription`).** The hero screen. A single card: plan name and price, a
   **status** pill, and a **dates line** that changes with the state (see below). Under it, the actions the state
   allows and nothing else: *Change plan*, *Pause* (1, 2 or 3 periods), *Cancel*, *Undo cancellation*, *Update
   payment method*. Below the card, **billing history**: one row per charge attempt with date, amount, outcome, and
   line items where they exist. A proration shows as two lines ("Credit for unused Basic, 15 days −$15.00",
   "Pro for the rest of the period, 15 days $30.00"); an invoice paid by downgrade credit shows "$0.00, paid by credit".
   - **Change plan** must show the prorated amount *before* the member confirms: "You'll be charged $15.00 today" for
     an upgrade, "$15.00 credit goes to your next invoice" for a downgrade (no cash refunds).
   - **Pause** must show the effect before confirming: "No charges until Jan 14. Your next charge moves to Feb 14."
   - **Cancel** must show the paid-through date before confirming: "You keep access until Nov 14. Nothing more will be
     charged. You can undo this until then." A trial cancels at once ("Your trial ends now, nothing was charged").
2. **Plan picker at signup.** Active plans as cards: name, price per interval, trial length ("14 days free, then
   $30.00/month"). Archived plans never appear here. The confirmation states the first charge date and amount. A plan
   with no trial is charged at signup (D-015): "You'll be charged $30.00 today", and a decline creates nothing and
   shows the error inline, so the member can try another card.
3. **Operator subscribers list (`/o/[org]/subscribers`).** One row per subscription: member, plan, status pill,
   next event and its date. Filterable by status. A **past-due** section sits on top with the retry number and the
   next retry date, and the day it cancels if nothing changes, because that is where the operator acts.
4. **Operator subscription detail (`/o/[org]/subscribers/[id]`).** The member card from screen 1 seen read-only, the
   full charge history, and an **audit timeline**: every state change with who (member, operator or *system* for the
   billing job), from → to, and the date. Dunning cancellation and voluntary cancellation must read differently
   ("Cancelled: payment not recovered after 3 retries" vs "Cancelled by member").
5. **Plans (`/o/[org]/plans`).** Built and unstyled. A list of plan cards (name, price/interval, trial, archived tag)
   with *Rename* and *Archive*, and a *New plan* form. The note that price, interval and trial cannot change after
   creation must be visible next to the form, not buried.
6. **Home (`/`).** A simple landing: what BoxLoop is, *Sign in*, and *Demo accounts* when demo mode is on.
7. **Everything else** (login, demo picker, onboarding, account security, org settings, legal, shared link). These are
   template-owned and **cannot be edited**. They must look right through global styles alone. Note that
   `/o/[org]/settings/billing` is the template's own SaaS billing page, not BoxLoop's member billing; it must not be
   confused with screen 1.
8. **Metrics (`/o/[org]/metrics`).** Built (P1) and unstyled: MRR, churn and trial conversion over the run, as
   numbers plus a chart. Style it with the chart palette from the tokens; no new chart types.

## States that must be designed, not left to chance

- **Subscription status** (pill plus dates line). Each gets a colour *and* text/icon, never colour alone:
  - `trialing`: "Trial ends Oct 15, then $30.00/month"
  - `active`: "Renews Nov 14 for $30.00" (less any credit: "Renews Nov 14 for $15.00 after $15.00 credit")
  - `past_due`: "Payment failed Oct 1. Retry 2 of 3 on Oct 4. Cancels Oct 11 if unpaid." plus *Update payment method*
  - `paused`: "Paused until Jan 14. Next charge Feb 14."
  - `pending_cancellation`: "Ends Nov 14. Nothing more will be charged." plus *Undo cancellation*
  - `cancelled`: "Ended Nov 14" (voluntary) or "Ended Oct 11, payment not recovered" (dunning)
- **Charge outcome** in history: succeeded, failed (with reason, e.g. card declined), paid by credit.
- **Money preview** before any confirm: upgrade charge today, downgrade credit, no charge (pause, cancel).
- **Role:** member versus operator. An operator sees subscriptions read-only; a member never sees another member.
- **Empty states:** no plans yet, no subscribers, no charges yet (trialing), no past-due members.
- **Errors from actions:** `ActionForm` renders a server error inline under the form ("cannot pause a trialing
  subscription", "a pause is 1 to 3 billing periods"). Style it, and suggest friendlier wording. One needs it most:
  on the billing day, before the daily run, plan change and pause are refused as "outside the paid period" (D-020);
  the member should read something like "Your renewal is being processed today. Try again tomorrow."
- **404:** another org's subscription is a 404 on purpose (tenant isolation). It should look like a normal not-found.

## Hard constraints for the implementation

- **One global stylesheet, no UI library.** Nothing is styled today and no CSS framework is installed. Plan the design
  as CSS custom properties (tokens) plus element and class styles in a single `src/app/globals.css` imported by the
  root layout. That is the only way template-owned pages pick it up without being edited.
- **Style semantic HTML first.** Pages use `main`, `h1`, `h2`, `section` (one per card), `p`, `form`,
  `label > input`, `select`, `button`, `table` (history), `details/summary` and `footer`. Clone-owned pages may add a
  few classes, but the design must hold up with **zero classes**.
- **Money is shown as `$30.00`**, always two decimals, tabular figures; credits with a minus sign.
- **Dates are calendar days** ("Nov 14", "Nov 14, 2026" when the year differs). No times of day anywhere: billing
  runs once a day and every date in the system is a day.
- **Light and dark**, via tokens under `prefers-color-scheme`.
- **Mobile first**: 360px wide with no horizontal scroll. Billing history may collapse to stacked rows.
- **Accessibility:** AA contrast, visible focus rings, 44px touch targets, status never by colour alone.
- **No images or illustrations required.** A wordmark and system or Google fonts are enough.

## Out of scope (cut on purpose)

Do not design card entry (the mock provider has an "approves/declines" switch, shown as a plain toggle in the demo),
refunds, coupons (they exist, but are applied from the CLI only), taxes, multi-currency, shipping, or marketing pages. The metrics page is screen 8;
tokens need one chart palette for it, nothing more.

## What I want back from Claude Design

1. A token sheet: colour (one per status family: trial, good standing, at risk, on hold, ending, ended), type scale,
   spacing, radius, shadow.
2. Mockups of screens 0–4 at mobile and desktop width, plus the home page and the metrics page.
3. The member subscription card as a component with every status variant on one board, each with its dates line
   and actions.
4. The three confirm dialogs (change plan, pause, cancel) with their money/date previews.
5. Notes on anything in the flows above that the design suggests changing (wording, action order).

## How it gets implemented (for the build session, not for Claude Design)

`globals.css` goes in first, imported from `src/app/layout.tsx`, and the metadata title changes to *BoxLoop*. Then
the header and home page, then the member page and the operator pages as new clone-owned routes over the existing
functions (`signup`, `changePlan`, `pause`, cancel from P0-8, `updateCard`). After that: `npm run foundation:drift` (no
template path touched), `npm run test:e2e`, and a screenshot pass at 360px and 1280px in both themes.
