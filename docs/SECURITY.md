# Security

An honest assessment of BizPilot as it stands. This is a working product, not an
audited one: no penetration test has been run against it and no third party has
reviewed it. What follows is what I know to be true from reading the code.

It holds real money records for real shops, so the weaknesses are listed plainly
rather than buried. Severity is my own judgement.

---

## What is done properly

These are load-bearing and worth not breaking.

**Tenant isolation is structural, not filtered in.** Every business-owned row
carries `businessId`; every service method takes it as its first argument; it
always comes from the JWT via `@BusinessId()`, never from a request body or URL
parameter. A client has no way to name another shop's data. This is verified by
the smoke test, which confirms a second business gets a 404 rather than a 403 —
it is not even told the record exists.

The AI assistant follows the same rule more strictly: its nine tools are built
as closures over one `businessId` before the model is handed them, so no prompt
can widen their reach.

**Passwords.** bcrypt at cost 12. Login compares against a dummy hash when the
user does not exist, so response time does not reveal which emails are
registered. Minimum eight characters with at least one letter and one digit.
Changing a password revokes every session.

**Refresh tokens.** Opaque 48-byte random strings, not JWTs — only the SHA-256
hash is stored, so a database leak yields nothing usable, and there is no
signature to forge. Presenting one burns it and issues a new pair, so a stolen
token works at most once.

**Payments are verified, never trusted.** Both the Flutterwave webhook and the
browser redirect call the verify endpoint server-side before anything is
credited. The webhook signature is compared in constant time and **rejected
outright when no hash is configured** — an unset secret does not silently mean
"accept everything". Settlement is idempotent on our own `tx_ref`, so a replayed
webhook cannot double-credit.

**Input validation.** A global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so an unexpected field is a 400 rather than something
that quietly reaches Prisma.

**SQL injection.** All raw SQL uses Prisma's tagged-template `$queryRaw`, which
parameterises. There is no string concatenation of user input anywhere in the
query layer.

**Configuration fails closed.** Zod validates the whole environment at boot and
the process refuses to start if anything required is missing — or if a JWT
secret still holds a development placeholder in production. Swagger is disabled
outside development.

**The platform dashboard is gated outside the product.** `PLATFORM_ADMIN_EMAILS`
is an environment variable, not a database column, so no in-product screen can
grant it and a compromised owner account cannot escalate into it. An empty list
means nobody. Verified: a normal shop owner gets 403, unauthenticated gets 401.

---

## Weaknesses

### High

**1. Refresh tokens live in `localStorage`.**
`apps/web/src/lib/api.ts` stores both tokens there. Any successful XSS — a
malicious dependency, a compromised CDN, a future injection bug — hands the
attacker a 30-day refresh token, and rotation does not help because the attacker
can simply use it. `httpOnly`, `Secure`, `SameSite=Strict` cookies would put the
refresh token out of JavaScript's reach. This is the single change with the
largest security return.

**2. No refresh-token reuse detection.**
Rotation revokes the presented token, but replaying an already-burned one just
returns 401. It does not revoke the rest of that token's family or raise
anything. So if a token is stolen and the attacker refreshes first, they hold a
valid chain and the legitimate user is quietly logged out — which reads to them
as a glitch, not a breach. Standard fix: mark a family on reuse and kill all its
descendants.

**3. Anyone can register with any email, and there is no verification.**
Nothing proves the person signing up controls the address. Combined with the
email-keyed platform allow-list, there is a real chain: if an address in
`PLATFORM_ADMIN_EMAILS` does not yet have an account, whoever registers it first
gets the platform dashboard — every customer's turnover. Register your admin
account immediately after setting that variable, and add email verification
before the product is public.

### Medium

**4. CORS falls open when `CORS_ORIGINS` is empty.**
`main.ts` reads `origin: corsOrigins.length ? corsOrigins : true` with
`credentials: true`. The Zod schema defaults the variable to
`http://localhost:5173`, so this only triggers if someone deliberately sets it
to an empty string — but the failure mode is "allow every origin" when it should
be "allow none". Fail-closed is one line.

**5. There is no password reset.**
No forgot-password flow exists. An owner who forgets their password is locked
out of their own business records permanently, with no recovery except direct
database access. This is an availability problem today and will become a support
problem the day there is a second customer.

**6. Rate limiting is per-instance and in memory.**
`ThrottlerModule` is configured without a Redis store, so the limits (120/min
globally, 5/min on login, 10/min on the assistant) are counted per process. On
Render's single free instance that is fine; the moment the API scales to two
instances the effective limit doubles, silently. Redis is already a dependency,
so pointing the throttler at it is cheap.

**7. Almost nothing is audited.**
The `AuditLog` table exists but only sales write to it. There is no record of
logins, failed logins, staff accounts being created, roles changing, prices
changing, or records being deleted. For a product holding money records — where
the realistic threat is an insider, not an outsider — this is the gap I would
close first after the token storage.

**8. Staff passwords are chosen by the owner.**
`inviteUser` takes a plaintext password in the request: the owner types a
password for their cashier and presumably tells it to them. There is no invite
email and no forced change on first login, so the owner knows every staff
password, and per-user accountability in the audit trail is weaker than it
looks. It is a reasonable simplification for shops where staff may not have
email — but it should be a deliberate, documented choice, and a first-login
password change would cost little.

**9. No two-factor authentication anywhere**, including the platform dashboard,
where a single password stands between an attacker and every customer's
financial data.

### Low

**10. `logoUrl` is an unvalidated string.**
`UpdateBusinessDto` accepts any string and it is rendered as an `<img src>` on
the public invoice page, which is reachable without authentication. Browsers do
not execute `javascript:` in `img src`, so this is not XSS, but there is no
scheme allow-list and no length bound, and it lets a shop point an image
request from its customers' browsers at any host it likes. An `IsUrl` check
restricted to `http`/`https` closes it.

**11. `BigInt.prototype.toJSON` bypasses the safe-range guard.**
`common/utils/money.ts` has `toNumber()`, which throws above
`Number.MAX_SAFE_INTEGER`. But responses are serialised by the prototype patch
in `main.ts`, which calls `Number(this)` with no check — so the guard is not
actually on the path the data takes. The threshold is about 90 trillion RWF, so
this is a latent correctness bug rather than a live one, but the comment in
`main.ts` claiming the guard protects it is wrong today.

**12. Public invoice links are bearer links by design.**
Anyone with the URL can see the invoice: amounts, line items, the customer's
name. That is what makes the link usable over WhatsApp, and the token is a v4
UUID (122 bits), so it cannot be guessed. Worth stating explicitly because it is
a deliberate trade-off, not an oversight — but a forwarded link leaks a
customer's purchase history.

**13. No Content-Security-Policy tuned for the app.**
Helmet is applied with defaults and `crossOriginResourcePolicy: cross-origin`.
The web app is served as a static site by Render, so the API's CSP does not
protect the pages a user actually loads. Given weakness 1, a CSP on the static
site is worth more than usual.

---

## Data protection

Rwanda's Law No. 058/2021 on personal data protection applies to this product.
BizPilot stores personal data belonging to people who never signed up for it —
the shop's **customers**: names, phone numbers, purchase histories and debts.

What does not exist yet:

- No privacy policy or terms of service.
- No consent capture for the customer phone numbers used for SMS reminders.
- No way for a shop's customer to request their data or have it erased.
- Deletes are soft (`deletedAt`), so "delete this customer" retains the row
  indefinitely.
- No documented retention period and no encryption at rest beyond whatever the
  hosting provider provides by default.

None of this blocks a pilot with shops that understand it. It does need
resolving before the product is marketed publicly.

---

## If you do only three things

1. Move refresh tokens into `httpOnly` cookies.
2. Add email verification at signup — and register your platform-admin address
   before anyone else can.
3. Write audit rows for authentication, staff changes and deletions.

## Reporting something

There is no security contact configured yet. Add one to the README before the
first outside user, and check that the address is monitored.
