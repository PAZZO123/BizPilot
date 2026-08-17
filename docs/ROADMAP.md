# What is missing

Written as a list of gaps rather than a wish list. Everything here is either
absent or half-built today.

Ordering is by what stands between BizPilot and a paying customer, not by what
is interesting to build.

---

## Before a real shop depends on this

These are not features. Without them, someone loses their records.

**The Render free database is deleted after 30 days.** This is the one that will
actually destroy a shop's books. Upgrade to a paid Postgres instance and turn on
daily backups before onboarding anyone.

**The free API instance sleeps after 15 minutes idle** and takes roughly 50
seconds to wake. A shopkeeper with a queue of customers will not wait — and
while it sleeps, the cron jobs that mark invoices overdue and send reminders do
not run either.

**There are no backups.** Not configured, not tested. A backup nobody has
restored from is not a backup.

**Password reset is built but not deliverable.** The flow exists end to end —
emailed single-use token, thirty-minute expiry, all sessions revoked on
completion — but with `MAIL_PROVIDER=log` (the default) the link lands in the
server log, not an inbox. Set `MAIL_PROVIDER=resend` with `RESEND_API_KEY` and
a verified sending domain in `MAIL_FROM`; the free tier's 100 emails/day is
plenty for resets.

**Nothing is monitored.** No error tracking, no uptime check, no alert if the
SMS queue stops draining or Flutterwave webhooks start failing. The first
indication of a problem would be a customer phoning.

---

## Missing product

### Offline
The single biggest gap for the actual market. Rwandan shops lose connectivity
routinely, and BizPilot currently stops working when the network does — at
exactly the moment a customer is standing at the counter with money. Recording a
sale offline and syncing later is what would make this indispensable rather than
convenient. It is also genuinely hard: it needs a local store, a sync protocol,
and a conflict rule for stock counts that two devices both decremented.

### Kinyarwanda
The interface is English-only. A large share of the target users are more
comfortable in Kinyarwanda, and "the notebook is easier" is a real competitor.
VegetableHub already has an i18n setup that could be lifted.

### Receipt printing
No thermal-printer support and no printable receipt. Customers ask for one, and
some businesses are legally required to give one.

### EBM / RRA compliance
Rwanda requires VAT-registered businesses to issue invoices through an
Electronic Billing Machine. BizPilot has a `defaultTaxBps` field and prints a
tax line, but is not integrated with the RRA. Until it is, a VAT-registered
business cannot use it as their only system — which rules out most hardware
stores and pharmacies, two of the five named target segments.

### Purchase orders and suppliers
Stock can be adjusted upward but there is no concept of a supplier, a purchase
order, or what you owe them. A shop knows what its customers owe it and not what
it owes its own suppliers, which is half the picture.

### Multi-location
The `Location` model exists and every business gets a "Main" location, but
nothing uses it. Per-location stock and reporting is a Business-plan feature
that is currently sold but not delivered — check `PLANS.business.features.multiLocation`
before advertising it.

### Data export
Partly delivered. `dataExport` now unlocks two printable PDFs — the profit &
loss statement and the daily cash-up sheet, both with signature blocks. What is
still missing is raw export: CSV of sales, products and customers, so an owner
can take their data to an accountant or leave for another product without
asking. A paid feature called "data export" that only produces PDFs is a
stretch.

### Timezones
`Business.timezone` is stored and ignored. Every date boundary — "today",
start-of-month, the cash-up day — uses the **server's** local time. For a
single-country product on a Kigali-region server this is invisible; it breaks
the moment a shop in another timezone signs up, or the server region changes.

### Returns and refunds
A sale can be voided in full. There is no partial return, no refund to a
customer, and no restocking of a single line.

---

## Missing on the revenue side

The plumbing that turns usage into income.

**Nothing prompts an upgrade.** When a shop hits a plan limit the API returns a
clear `PlanLimitReached` error, and the web app shows it as a toast. There is no
in-context upsell, no "you are at 90% of your sales", no email when a trial is
three days from ending. The platform dashboard now shows which trials are ending
and which of those shops are actually being used — but contacting them is
manual.

**No annual billing.** Monthly only. Annual prepayment at a discount would
improve cash flow and cut churn, and Flutterwave supports it.

**No dunning.** When a payment fails the subscription goes `PAST_DUE` and access
continues through a grace period, then drops. Nobody is told, and no retry is
attempted.

**The assistant's cost is now measured, not guessed.** Every assistant reply
records its real input and output token counts on `AiMessage`, and the platform
dashboard prices the AI line from those at `AI_INPUT_RWF_PER_MTOK` /
`AI_OUTPUT_RWF_PER_MTOK` (older, unmetered replies still use the
`AI_COST_PER_MESSAGE_RWF` estimate). What remains is judgement, not plumbing:
check the dashboard's figure against a real provider invoice after the first
month, keep the RWF-per-Mtok rates current when the exchange rate moves, and
switch `ANTHROPIC_MODEL` to `claude-sonnet-5` if Starter's 300-question
allowance does not cover its own cost.

**No referral mechanism.** Shopkeepers in one market know every other
shopkeeper in that market. This is the cheapest distribution available and there
is nothing built for it.

---

## Engineering debt

**Test coverage is one smoke script.** `scripts/smoke.sh` covers 26 assertions
end to end — auth, the sale transaction, the oversell guard, stock movement,
reports, PDF generation and tenant isolation. That is meaningful, but there are
no unit tests, and the money helpers (`applyBps` rounding, `parseMoney`) are
exactly the kind of pure functions that should have them. There are no frontend
tests at all.

## The payment provider: built on MoMo, pending MTN's approval

The MTN MoMo integration is **built and working against the sandbox**: the
adapter (`mtn-momo.service.ts`), the PUSH screen — phone-number field, "approve
on your phone" state, polling — and settlement that re-queries MTN for the real
amount before crediting. `PAYMENT_PROVIDER=mtn-momo` selects it; Flutterwave
remains the alternative adapter behind the same `payment-provider.ts` seam.

Two things the sandbox taught, so nobody re-learns them:

- **The sandbox settles EUR only.** RWF appears the moment production
  credentials do; the settlement path relaxes the currency check in sandbox
  only (`isSandbox`), never in production.
- **MTN rejects non-ASCII in the handset prompt** with a bodyless 400 — an em
  dash in a plan name once broke every checkout. `toMomoText()` folds text to
  ASCII before sending; keep it on that path.

There is no payee number to configure: money lands in the merchant wallet the
API credentials belong to. Which wallet gets paid is decided at MTN onboarding,
not in the app.

What still has to happen is commercial, not code:

1. **Start MTN production onboarding now** (momodeveloper.mtn.com → the
   Collections product). It needs business verification and takes time — it is
   the gate between the working sandbox demo and receiving real money.
2. **Paste the production credentials** into Render and set
   `MOMO_TARGET_ENVIRONMENT=production` with the production base URL. The app
   already behaves correctly on both sides of that switch.

Given mobile money is around 90% of payments in Rwanda, PUSH is the flow that
matters. Cards are the edge case here, not the default — and if MTN onboarding
stalls, the Flutterwave adapter is the fallback to actually attempt, since that
choice was made from documentation, not from trying to sign up.

**No CI.** Nothing runs the typecheck, the build or the smoke test on push. The
first production deploy failed on something a five-second CI job would have
caught, and the feedback loop was a ten-minute cloud build instead.

**`packages/shared/tsconfig.json` still uses `moduleResolution: "node"`.** That
is the old node10 algorithm. TypeScript 5 accepts it with a deprecation warning;
TypeScript 6 and 7 remove it outright, so this breaks the moment the toolchain
is upgraded. Move it and `module` to `node16` together — deliberately, with the
build verified, not during a deploy.

**The dashboard cache is invalidated by hand.** `reports.invalidate()` is called
after writes. A missed call means a shopkeeper sees a stale figure for 60
seconds and doubts the product.

**No database indexes have been reviewed against real query plans.** The obvious
ones are declared, but nothing has been `EXPLAIN`ed against a table with a
year of sales in it.

**`AuditLog` is written by exactly one service.** Either use it everywhere or
delete it — a half-populated audit table is worse than none, because it looks
like a record.

---

## Rough order I would work in

1. Paid database + backups + monitoring. *(Nothing else matters if the data goes.)*
2. ~~Password reset~~ *(done — turn on a real `MAIL_PROVIDER`)*, email
   verification, refresh tokens into cookies.
3. Trial-ending emails and in-app upgrade prompts. *(The first revenue that is currently being left on the table. The mail seam now exists, so the emails are wiring, not infrastructure.)*
4. ~~Real AI cost measurement~~ *(done)* — now make the pricing decision the
   dashboard's real numbers point to.
5. Kinyarwanda.
6. Offline sales.
7. EBM integration — the gate on pharmacies and hardware stores.
