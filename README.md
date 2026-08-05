# BizPilot

Sales, stock, invoicing, expenses and profit for small businesses — built for shops
that currently run on a notebook.

A shopkeeper opens it on their phone, taps the products a customer is buying, takes
the money, and BizPilot does the rest: stock comes down, profit is calculated
against what the goods actually cost, debtors are tracked and texted, and invoices
go out with a link the customer can pay from their own phone.

---

## What is in the box

| Area | What it does |
|---|---|
| **Point of sale** | Tap-to-sell product grid, price overrides for haggling, cash / MoMo / card / credit, receipt numbering |
| **Inventory** | Stock moves with every sale, append-only movement ledger, restock and damage adjustments, low-stock alerts, dead-stock report |
| **Invoicing** | Invoices from scratch or from a credit sale, PDF generation, public payment link, automatic overdue marking |
| **Expenses** | Categorised spending so the profit figure means something |
| **Reports** | Profit & loss, gross margin, best sellers by profit, spend by category, payment-method mix, busiest hours, cash tied up in dead stock |
| **End of day** | Cash-up: what should be in the drawer, counted against what is, plus who served and when the money came in |
| **Platform dashboard** | Your own books — MRR, trials ending this week, churn, cash collected, and what SMS and AI cost you against it |
| **AI assistant** | Ask questions in plain language ("who owes me money?") answered from the business's own records via Claude tool use |
| **SMS** | Queue-backed reminders, automatic 3-day overdue nudges, Africa's Talking / Twilio / log providers |
| **Payments** | Flutterwave — MTN MoMo, Airtel Money, cards, RWF settlement |
| **Billing** | Free / Starter / Business plans, 14-day trial, usage metering, plan-limit enforcement |
| **Multi-user** | Owner / manager / cashier roles, per-role screens |

---

## Documentation

| Document | What is in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system works, module by module, and the two rules that explain most of the code |
| [docs/SECURITY.md](docs/SECURITY.md) | What is done properly, and an honest list of the weaknesses with severities |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is missing — including what must be fixed before a real shop depends on it |

---

## Stack

React + TypeScript (Vite) · NestJS · PostgreSQL + Prisma · Redis + BullMQ · Docker ·
Claude API · Flutterwave

```
apps/
  api/        NestJS — REST API, Prisma schema, queues, cron jobs
  web/        React — the app the shopkeeper uses
packages/
  shared/     Plan definitions and money helpers shared by both
```

---

## Running it locally

**You need:** Node 20+, Docker Desktop.

```bash
git clone <your-repo> bizpilot && cd bizpilot
npm install

# Postgres + Redis
npm run infra:up

# Point the API at them
cp apps/api/.env.example apps/api/.env

# Create the schema and fill it with a realistic demo shop
npm run db:migrate
npm run db:seed
```

Then, in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:5173 and log in as **demo@bizpilot.rw** / **demo1234**.

The seed builds three months of trading for a Kigali mini-market: ~1,100 sales with
weekday and time-of-day patterns, real products and prices, credit customers, an
overdue invoice and a deliberately overstocked item so every report has something
true to show.

API docs (dev only): http://localhost:4000/api/docs

> **Ports:** Postgres is on **5434** and Redis on **6380**, not the defaults — this
> machine already had something on 5432/5433. Change them in `docker-compose.yml`
> and `apps/api/.env` if you prefer.

### Useful commands

```bash
npm run db:studio      # browse the database
npm run infra:reset    # wipe Postgres and Redis and start clean
npm run build          # production build of everything
```

---

## Deploying to Render

The repo has a blueprint that creates all four pieces at once.

**1. Push to GitHub, then:** Render dashboard → **New → Blueprint** → pick the repo.
It reads `render.yaml` and creates the Postgres database, Redis, the API and the
static site.

**2. Wire the two URLs to each other.** Render will not know them until the services
exist, so set these by hand afterwards:

| Service | Variable | Value |
|---|---|---|
| `bizpilot-api` | `WEB_URL` | `https://bizpilot-web.onrender.com` |
| `bizpilot-api` | `CORS_ORIGINS` | the same URL |
| `bizpilot-web` | `VITE_API_URL` | `https://bizpilot-api.onrender.com/api` |

Then trigger a manual deploy of **bizpilot-web** — `VITE_API_URL` is baked in at
build time, so it will not pick the change up on its own.

**3. Add your secrets** to `bizpilot-api` (Environment tab):

- `PLATFORM_ADMIN_EMAILS` — your own email. This is what unlocks the platform
  dashboard (your MRR, every shop's usage). Blank means nobody can see it. Then
  **register that email as an account immediately** — the allow-list is matched on
  email, so leaving it unclaimed means whoever signs up with it first gets in.
- `ANTHROPIC_API_KEY` — from console.anthropic.com. One key serves every shop;
  owners never supply their own. Leave blank and everything works except the
  assistant, which says so politely.
- `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_WEBHOOK_HASH` — invent a long random string, then paste the same value
  into Flutterwave → Settings → Webhooks → *Secret hash*.
- `AFRICASTALKING_USERNAME` / `AFRICASTALKING_API_KEY`, and set `SMS_PROVIDER` to
  `africastalking`, when you are ready to send real texts.

**4. Point Flutterwave's webhook at** `https://bizpilot-api.onrender.com/api/webhooks/flutterwave`.

Migrations run automatically on every deploy (`prisma migrate deploy` in the start
command), so there is nothing manual to do on release.

### Before you take real money

The blueprint uses Render's **free** plans so you can see it working for nothing.
Three things must change before a real shop depends on it:

1. **Upgrade the database.** A free Render Postgres is **deleted after 30 days**.
   This is the one that will actually lose somebody's business records.
2. **Upgrade the API instance.** A free web service sleeps after 15 minutes idle and
   takes ~50 seconds to wake — a shopkeeper with a queue of customers will not wait.
   Sleeping also stops the cron jobs that mark invoices overdue and send reminders.
3. **Set up backups.** Render's paid Postgres has daily backups; turn them on.

---

## How the money works

Three plans, defined once in `packages/shared/src/plans.ts` and enforced by the API —
the pricing page and the limits can never drift apart.

| | Free | Starter — RWF 7,000 / $6 | Business — RWF 20,000 / $17 |
|---|---|---|---|
| Products | 30 | 500 | Unlimited |
| Sales / month | 100 | Unlimited | Unlimited |
| Staff | 1 | 3 | 15 |
| SMS / month | 0 | 100 | 500 |
| AI questions / month | 15 | 300 | 2,000 |
| Your logo on invoices | — | ✓ | ✓ |
| Online payments | — | ✓ | ✓ |

Every new shop gets 14 days of Starter, no card. When the trial ends they drop to
Free — nothing is deleted, the limits just apply.

**Changing a price** means editing `plans.ts` and redeploying. The checkout, the
pricing page, the usage bars and the enforcement all read from it.

### Watch your margins

- **AI.** The assistant defaults to `claude-opus-5` at `low` effort. A typical
  question runs two or three tool calls. On the Starter plan's 300-question
  allowance this is the item most likely to cost more than you charge —
  measure it in your first month, and switch `ANTHROPIC_MODEL` to
  `claude-sonnet-5` if the numbers do not work.
- **SMS.** Africa's Talking is a few francs per message. The cost the gateway
  reports is stored on every `SmsMessage` row, so you can total it.
- **Payments.** Flutterwave takes its cut of each transaction; the plan prices above
  are what you receive before that.

---

## Notes on how it is built

Things worth knowing before you change anything.

**Money is never a float.** Every amount is an integer in the currency's minor unit
(RWF ×100), stored as `BigInt`. A plain `Int` tops out around 21M RWF, which a
hardware store would pass in a month. Convert only at the display boundary.

**Raw SQL must quote column names.** Tables are snake_case (`sale_items`) but
columns keep Prisma's camelCase (`"costTotal"`). Postgres folds unquoted identifiers
to lower case, so `SUM(cost_total)` fails while `SUM("costTotal")` works. Aggregates
also need `::bigint` — Postgres widens `SUM(bigint)` to `numeric`, which arrives as a
Decimal object and breaks the moment it meets a BigInt.

**Cost is snapshotted at sale time.** `SaleItem.unitCost` copies the product's cost
when the sale happens, so restocking at a new price never rewrites last month's
profit.

**Tenancy is bound in code.** Every business-owned row carries `businessId` and every
query filters on it — including the AI assistant's tools, which are built as closures
over one business id before the model ever sees them. There is no prompt that can
reach another shop's data.

**Payments are verified, never trusted.** Both the webhook and the browser redirect
call Flutterwave's verify endpoint before crediting anything, and both are idempotent
on our own transaction reference — a replayed webhook cannot double-credit.

**Revenue is recognised when the sale happens**, not when the cash arrives. That is
what makes profit meaningful for a shop that sells on credit; `cashCollected` is
reported next to it so the difference is visible.

**Chart colours were validated, not chosen by eye.** `apps/web/src/lib/charts.ts`
holds two categorical palettes, one per surface, and both pass contrast and
colour-blind separation checks. There are two because the light set measurably
fails on a dark background — indigo falls out of the lightness band and seven of
the eight drop under 3:1 contrast. The dark set is the same eight hues re-stepped,
in the same order, so a series keeps its identity when the theme changes. Do not
reorder or extend either casually — adjacency is what was tested.

**Dark mode is a set of overrides, not a `dark:` class on every element.** The rules
at the bottom of `apps/web/src/index.css` remap the light utility classes
(`bg-white`, `text-slate-900`, `border-slate-200`…) under `html.dark`. A new screen
written in the ordinary light classes is therefore dark-ready the moment it exists,
and nobody has to remember a second class. The theme itself is set on `<html>` by an
inline script in `index.html` before the first paint — a `useEffect` would flash a
white page at anyone who chose dark. `text-slate-300` and lighter are deliberately
left alone; they only ever sit on something already dark.

**The landing hero images live in `apps/web/public/hero/`.** They ship as SVG scenes
so the page stays quick on a slow connection and never shows a broken image. Swap in
real photographs by keeping the filenames, or edit the list at the top of
`apps/web/src/components/HeroBackdrop.tsx`. Keep them landscape and dark-ish — white
headline text sits on top. The drift and crossfade stop entirely under
`prefers-reduced-motion`.

**Vite's root comes from `realpathSync.native(process.cwd())`, and that matters.**
This repo lives under a directory with a space in its name, so a launcher can start
the dev server through the Windows 8.3 short path (`MYPROJ~1`). Vite resolves module
ids through a realpath call and always gets the long spelling back; if the root is
still the short one the two strings do not match, Vite decides `main.tsx` sits
outside the project and serves it untransformed. The symptom is a blank page with
nothing in the browser console and `Failed to load url /src/main.tsx` in the server
log.

---

## Testing

The backend has an end-to-end smoke test covering auth, the sale transaction, the
oversell guard, stock movement, reports, PDF generation and tenant isolation. Run the
API and the seed first, then:

```bash
bash scripts/smoke.sh
```

---

## Licence

Private.
