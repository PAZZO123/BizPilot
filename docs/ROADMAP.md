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

**There is no password reset.** See [SECURITY.md](SECURITY.md#medium) — an owner
who forgets their password today has no route back into their own data.

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

**Nobody knows what the assistant actually costs.** The platform dashboard
prices it from `AI_COST_PER_MESSAGE_RWF`, a guess. Token usage is not recorded
per message. On `claude-opus-5` with Starter's 300-question allowance against
RWF 7,000/month, this is the line most likely to cost more than it earns — and
it is currently unmeasured. Record real token counts on `AiMessage`, compare
against an Anthropic invoice, and switch `ANTHROPIC_MODEL` to `claude-sonnet-5`
if the numbers do not work.

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

## The payment provider is unresolved

**Do not treat the Flutterwave integration as finished.** It is complete and
correct as code — hosted checkout, verified amounts, idempotent settlement,
signed webhooks — but it may be built on a provider that will not open a
merchant account in Rwanda. Stripe was ruled out for exactly that reason and
Flutterwave was chosen as the alternative; that choice was made from
documentation, not from trying to sign up.

`payment-provider.ts` is the seam. Settlement, entitlements and the billing
tables are provider-agnostic; a new provider is one adapter.

What still has to happen:

1. **Confirm what will actually onboard you.** This can only be settled by
   attempting it. Candidates worth trying: Pesapal, Elemipay, K-Pay, RwandaPay,
   DusuPay, and MTN's own MoMo API.
2. **Write the adapter.** The interface is documented and the settlement path
   already checks amount and currency, so an adapter is roughly the size of
   `flutterwave.service.ts`.
3. **Build the PUSH screen.** This is the part that is genuinely missing rather
   than merely unwritten. Mobile money does not redirect anywhere: you send a
   prompt to a phone number and wait. That needs a phone-number field, a "check
   your phone" state, and polling — none of which a redirect flow uses, and none
   of which exists today. `CheckoutResult` is a union specifically so this
   cannot be forgotten at compile time.

MTN's sandbox is free and self-service with no business verification, so the
PUSH flow can be built and demonstrated end to end before any commercial
agreement exists. Production needs approval from MTN, which takes time — start
it early.

Given mobile money is around 90% of payments in Rwanda, PUSH is the flow that
matters. Cards are the edge case here, not the default.

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
2. Password reset, email verification, refresh tokens into cookies.
3. Trial-ending emails and in-app upgrade prompts. *(The first revenue that is currently being left on the table.)*
4. Real AI cost measurement, then the pricing decision that follows from it.
5. Kinyarwanda.
6. Offline sales.
7. EBM integration — the gate on pharmacies and hardware stores.
