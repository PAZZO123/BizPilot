# How BizPilot works

This describes the system as it is built, module by module. It is written for
whoever changes the code next — including the author six months from now.

Companion documents: [SECURITY.md](SECURITY.md) for the honest list of what an
attacker could do, and [ROADMAP.md](ROADMAP.md) for what is missing.

---

## 1. The shape of it

```
browser  ──HTTPS──▶  NestJS API  ──▶  PostgreSQL   (everything durable)
                          │
                          ├──▶  Redis          (cache + BullMQ job queue)
                          ├──▶  Anthropic API   (the assistant)
                          ├──▶  Flutterwave     (subscriptions + invoice payment)
                          └──▶  Africa's Talking / Twilio  (SMS)
```

A single npm workspaces monorepo:

| Path | What it is |
|---|---|
| `apps/api` | NestJS. Every business rule lives here. |
| `apps/web` | React + Vite. A client. It enforces nothing. |
| `packages/shared` | Plan catalogue and money helpers, imported by both. |

`packages/shared` is the reason the pricing page can never disagree with what
the server enforces: `PLANS` is one object, the web app renders from it and the
API checks limits against it.

---

## 2. Two rules that explain most of the code

### Money is an integer, never a float

Every amount — prices, totals, costs, SMS gateway charges, subscription
payments — is an integer count of the currency's minor unit, stored as
PostgreSQL `BigInt`. RWF has no subunit in practice but is still stored ×100, so
one code path serves RWF and USD and rounding never surprises anyone.

`BigInt` and not `Int` because a plain 32-bit integer tops out near 21 million
RWF, which a hardware store passes in a month.

Conversion happens only at the display boundary (`formatMoney`) and the input
boundary (`parseMoney`). JSON has no BigInt, so `main.ts` installs a
`BigInt.prototype.toJSON` that emits a number.

### The tenant id is on every row and in every query

Every business-owned table carries `businessId`. Every service method takes it
as its first argument, and it comes from the JWT via the `@BusinessId()`
decorator — never from the request body or a URL parameter. A client cannot ask
for another shop's data because it has no way to name it.

The AI assistant follows the same rule in a stricter form: its tools are built
as closures over one `businessId` before the model is given them, so no prompt
can widen their scope.

---

## 3. The API, module by module

Everything sits under the `/api` prefix. Three global guards run in order:
`JwtAuthGuard` (authenticate), `RolesGuard` (authorise), `ThrottlerGuard`
(rate limit, 120 requests/minute).

### `common/`

| File | What it does |
|---|---|
| `prisma/prisma.service.ts` | The Prisma client, with connect/disconnect wired to Nest's lifecycle. |
| `redis/redis.service.ts` | Thin typed get/set/del over ioredis. Used for the dashboard cache. |
| `numbering/numbering.service.ts` | Allocates `INV-0042` / `RCP-0117` sequences per business without races. |
| `guards/jwt-auth.guard.ts` | Validates the access token unless the route is `@Public()`. |
| `guards/roles.guard.ts` | Checks `@Roles()`. **OWNER always passes** — so decorators only list the *lower* role that should also be allowed. |
| `filters/prisma-exception.filter.ts` | Turns Prisma error codes into HTTP responses (P2002 → 409, P2025 → 404) instead of leaking a stack trace. |
| `decorators/index.ts` | `@Public()`, `@Roles()`, `@RequiresPlan()`, `@CurrentUser()`, `@BusinessId()`. |

### `config/configuration.ts`

A Zod schema for the whole environment. The app **refuses to boot** if anything
required is missing or malformed, and refuses to boot in production if a JWT
secret still holds a development placeholder. A misconfigured deploy should fail
loudly at startup rather than silently at 2am when a webhook arrives.

### `auth/`

Registration creates the entire tenant in one transaction: business, its default
location, the owner user, and a trialing subscription. A half-created business
would be worse than a failed signup.

- **Access token** — a JWT, 15 minutes, carrying `sub`, `email`, `businessId`,
  `role`.
- **Refresh token** — an opaque 48-byte random string. Only the SHA-256 hash is
  stored, so a database leak does not yield usable tokens, and there is nothing
  to forge because it is checked against a row rather than a signature.
- **Rotation** — presenting a refresh token burns it and issues a new pair, so a
  stolen token is usable at most once.
- Login compares against a dummy bcrypt hash when the user does not exist, so
  response time does not reveal which emails are registered.
- Changing a password revokes every session.

### `entitlements/`

The single place that decides what a business may do right now.

The distinction that matters: `plan` on the row is what they **bought**;
`effectivePlan()` is what they can **use**. During a trial that is Starter; after
an expired trial it silently becomes Free — nothing is deleted, the limits just
apply. `PAST_DUE` keeps paid access during the grace period.

Metered limits (sales, SMS, AI messages) use `UsageCounter` rows keyed by
business + metric + month, incremented atomically. Checking and consuming are
deliberately separate calls so a failed request does not burn the customer's
quota.

### `products/`, `customers/`, `expenses/`

Straightforward CRUD with soft deletes (`deletedAt`). Products can opt out of
stock tracking (`trackStock: false`) for services and airtime.

### `sales/`

The most careful module in the codebase. Recording a sale, in one transaction:

1. Re-reads every product row and checks stock — the client's idea of stock is
   never trusted.
2. Refuses to oversell a stock-tracked product.
3. Snapshots `unitCost` onto each `SaleItem`. **This is why restocking at a new
   price never rewrites last month's profit.**
4. Decrements stock with a conditional update, so two cashiers selling the last
   item cannot both succeed.
5. Writes an append-only `StockMovement` row.
6. Updates the customer's balance if sold on credit.
7. Increments the monthly sales counter.

Voiding restores stock and marks the sale `VOIDED`; every report excludes voided
sales.

### `invoices/`

Invoices can be built from scratch or from a credit sale. `invoice-pdf.service.ts`
renders with PDFKit. Each invoice carries a random public token, so
`/pay/:token` is reachable without an account — that is the link the customer
receives. A daily cron marks overdue invoices and queues reminder SMS.

### `reports/`

Read-only and aggregate-heavy, so it uses raw SQL where Prisma's query builder
would force several round trips. Two rules apply to every query here:

- **Column names must be double-quoted.** Tables are snake_case (`sale_items`)
  but columns keep Prisma's camelCase (`"costTotal"`). Postgres folds unquoted
  identifiers to lower case, so `SUM(cost_total)` fails.
- **Every SUM needs `::bigint`.** Postgres widens `SUM(bigint)` to `numeric`,
  which Prisma deserialises as a Decimal — it satisfies the TypeScript types and
  then throws at runtime the first time it meets a BigInt operand.

Endpoints: `dashboard` (cached 60s in Redis), `profit-loss`, `revenue-trend`,
`top-products`, `dead-stock`, `sales-by-hour`, `cash-up`, `staff`, plus
`profit-loss.pdf` and `cash-up.pdf`.

The two PDF routes are gated on the `dataExport` plan feature and rendered by
`report-pdf.service.ts` on top of `common/pdf/pdf-builder.ts` — a small layer
over pdfkit that knows how to draw a table that paginates, a fill-in line, and a
signature block. They exist because a shop asked for figures by a landlord, a
co-operative, a loan officer or the RRA needs paper with a name on it, so every
document states its period, who produced it, and carries signature blocks.

The cash-up sheet is a **form**, not a report: the counted cash total is written
on it by hand at the till before it is signed. A figure typed into a screen by
the person holding the money is not a control. It is signed twice — by whoever
counted, and by whoever took the money off them.

Both read from the same `ReportsService` the screens use, so there is no second
calculation of profit that could disagree with what the owner saw.

**Revenue is recognised when the sale happens, not when the cash arrives.** That
is what makes profit meaningful for a shop selling on credit; `cashCollected` is
reported alongside so the difference is visible.

**`cash-up`** is the end-of-day close. The number that matters is `cashExpected`:
cash sales minus cash paid out for expenses. MoMo and card never touch the till
and a credit sale brings in nothing today, so neither belongs in the drawer
figure.

### `ai/`

Uses the Anthropic SDK's `client.beta.messages.toolRunner()` with nine tools
(`ai-tools.service.ts`): today's takings, stock levels, who owes money, best
sellers, and so on. Two deliberate choices:

- Tools return **formatted strings, not raw JSON**, so the model never has to
  guess a minor-unit conversion.
- Every tool is a closure over one `businessId`, bound before the model sees it.

With no `ANTHROPIC_API_KEY` the client is `null` and the endpoint returns a
`ServiceUnavailableException` with a plain message — not a 500. The key is one
server-side value shared by every shop; no shop owner ever supplies one.

### `sms/`

BullMQ queue over Redis with three interchangeable providers behind one
interface: `log` (development), `africastalking`, `twilio`. Every `SmsMessage`
row stores the cost the gateway reported, which is what makes margin
measurable.

### `billing/`

Flutterwave Standard checkout. The rules:

- **Nothing is credited on the browser's word.** Both the webhook and the
  redirect call Flutterwave's verify endpoint server-side first.
- The webhook signature is checked against the `verif-hash` header with a
  constant-time compare, and **rejects outright when no hash is configured** —
  an unset secret must not mean "accept everything".
- `settleTransaction` is the single idempotent settlement path for both routes,
  keyed on our own `tx_ref`, so a replayed webhook cannot double-credit.

### `admin/`

BizPilot's own books: MRR, ARR, trials in flight, trials ending within seven
days, churn, cash collected by month, signups by week, and cost-to-serve (SMS +
estimated AI) against revenue. Plus a table of every shop with usage, so a trial
that is actually being used can be told apart from one that is not.

This is the only code that reads across tenants, which is the exact opposite of
the rule everything else follows. That is why it is a separate module behind its
own `PlatformAdminGuard`, gated on the `PLATFORM_ADMIN_EMAILS` environment
variable rather than a database column — nobody can grant it from inside the
product, and an empty list means nobody rather than everybody.

---

## 4. The web app

React 18, Vite, TanStack Query for server state, Zustand for session and theme,
Tailwind, Recharts, react-hook-form + Zod.

| Path | Notes |
|---|---|
| `lib/api.ts` | Axios instance. One shared refresh promise, so ten concurrent 401s trigger one refresh rather than ten. |
| `lib/format.ts` | Money and date formatting. `currencyDisplay: 'code'` prints `RWF 1,200` — left alone, `Intl` renders RWF as "RF", which reads as a typo. |
| `lib/charts.ts` | Two validated categorical palettes, one per surface. See below. |
| `store/auth.ts` | Session, restore-on-load, role helpers. |
| `store/theme.ts` | Light/dark. Follows the OS until the user chooses once. |
| `components/Layout.tsx` | Sidebar on desktop, tab bar on phones. |
| `components/HeroBackdrop.tsx` | The drifting landing-page scenes. |
| `pages/` | One file per screen. |

Money is formatted at the display boundary only; the API sends minor units
throughout.

### Charts

The categorical palette is **validated, not chosen by eye** — lightness band,
chroma floor, colour-blind separation of adjacent pairs, normal-vision
separation, and contrast against the surface.

There are two palettes because the light one measurably fails on a dark
background: indigo `#4338CA` falls outside the lightness band and seven of the
eight drop below 3:1 contrast on `#1E293B`. The dark set is the same eight hues
re-stepped for that surface, in the same order so a series keeps its identity
when the theme changes. Both pass all six checks.

Do not reorder or extend either list casually — adjacency is what was tested.

### Dark mode

Implemented as overrides on the light utility classes under `html.dark` in
`index.css`, rather than a `dark:` variant on every element. Twenty-odd screens
already say `bg-white` and `text-slate-900`; mapping those centrally means a new
screen is dark-ready the moment it is written.

The class is set on `<html>` by an inline script in `index.html` **before first
paint** — doing it in a `useEffect` would flash a white page at anyone who chose
dark.

Recharts is the exception: it takes colours as props, so CSS cannot reach the
marks. `useChartTheme()` reads the theme store and returns the right values.

---

## 5. Running it

```bash
npm install
npm run infra:up          # Postgres on 5434, Redis on 6380
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run db:seed
npm run dev:api           # terminal 1
npm run dev:web           # terminal 2
```

`demo@bizpilot.rw` / `demo1234`. API docs at `/api/docs` in development only.

The seed builds three months of trading for a Kigali mini-market: ~1,100 sales
with weekday and time-of-day patterns, credit customers, an overdue invoice and
a deliberately overstocked item, so every report has something true to show.

### Two Windows gotchas that cost real time

**Vite's root must be `realpathSync.native(process.cwd())`.** This repo lives
under a folder with a space in its name, so a launcher can start the dev server
through the 8.3 short path (`MYPROJ~1`). Vite resolves module ids through the
same realpath call and always gets the long spelling back; if the root is still
the short one, Vite decides `main.tsx` is outside the project and serves it
untransformed. The symptom is a blank page, nothing in the browser console, and
`Failed to load url /src/main.tsx` in the server log.

**`incremental: false` in the API's tsconfig.** `nest build` deletes `dist/`,
but an incremental `tsbuildinfo` then skips re-emitting files it thinks are
unchanged, leaving a partial `dist/` and a `MODULE_NOT_FOUND` at runtime.

---

## 6. Deploying

Postgres runs on **Neon**, everything else on **Render**. The split exists
because Render's free Postgres is deleted after 30 days and Neon's free tier is
not.

That costs one piece of complexity, and it is worth knowing where it lives:
`schema.prisma` declares **two** connection URLs. `url` is Neon's pooled
endpoint and carries every query the app makes; `directUrl` bypasses the pooler
and exists solely for `prisma migrate`, whose advisory locks do not survive
transaction-mode pooling. On a database with no pooler in front of it — local
Docker — both are set to the same string.

`render.yaml` creates the other three services. After the first deploy, set by
hand:
`WEB_URL` and `CORS_ORIGINS` on the API, `VITE_API_URL` on the web service (it
is baked in at build time, so redeploy the static site after changing it), and
the secrets — `PLATFORM_ADMIN_EMAILS`, `ANTHROPIC_API_KEY`, the Flutterwave
keys, and the SMS credentials.

Migrations run automatically on every deploy via `prisma migrate deploy` in the
start command.

Read [ROADMAP.md](ROADMAP.md#before-a-real-shop-depends-on-this) before letting a
real shop rely on it — the free Render tier deletes the database after 30 days.
