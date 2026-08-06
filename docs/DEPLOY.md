# Putting BizPilot live on Render's free tier

Start to finish, about 30 minutes, most of it waiting for builds.

Two providers, both free: **Neon** for the database, **Render** for everything
else. That split is deliberate — Render's own free Postgres is deleted after 30
days, taking the data with it. Neon's free tier does not expire, which is the
difference between a link you can leave up and one that dies next month.

**Read this first.** One free-tier limit remains and it is not a setting you can
change: **the free Render API instance sleeps after 15 minutes of no traffic**
and takes roughly 50 seconds to wake. While it sleeps, the scheduled jobs that
mark invoices overdue and send SMS reminders do not run.

Perfect for a demo, a portfolio link, or letting a shopkeeper try it. Read
section 8 before anyone's actual takings go in.

---

## 1. Create the database on Neon

Do this first — Render needs the connection strings.

1. Sign up at [neon.tech](https://neon.tech). No card for the free tier.
2. Create a project. Two settings matter:
   - **Region: Europe (Frankfurt)** — `eu-central-1`. Match this to Render's
     region or every query pays a transatlantic round trip.
   - **Postgres version: 16**, to match what the migrations were written
     against.
3. Hit **Connect**, set the framework dropdown to **Prisma**, leave
   **Connection pooling** on, and click **Show password**. Neon prints two
   strings, on the `.env` tab:

   ```
   DATABASE_URL="postgresql://…@ep-xxx-pooler.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require…"
   DATABASE_URL_UNPOOLED="postgresql://…@ep-xxx.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require…"
   ```

   They are identical apart from **`-pooler`** in the first host.

> **Watch the name.** Neon calls the second one `DATABASE_URL_UNPOOLED`; this app
> calls it **`DIRECT_URL`**. Same value, different variable name — use ours when
> you paste into Render.

> **Why two?** The pooled endpoint is for the running app: Neon's compute scales
> to zero when idle and the pooler handles waking it and reconnecting. The direct
> one is for `prisma migrate`, which issues DDL and takes advisory locks.
>
> Neon's snippet says the direct URL is only needed on Prisma < 5.10, and this
> project is on 5.22 — so strictly it would work without. Set it anyway. It is
> the configuration Prisma documents for a pooled database, it costs nothing, and
> it removes a class of migration failure rather than trusting the pooler to
> handle DDL correctly. `schema.prisma` declares it and the env check requires
> it.

---

## 2. Create the Render services

Render reads `render.yaml` and builds three things — the database is Neon's job.

1. Sign up at [render.com](https://render.com) **with your GitHub account**; it
   makes the next step one click. No card for the free tier.
2. Dashboard → **New** → **Blueprint**.
3. Give Render access to the **BizPilot** repository, then pick
   `PAZZO123/BizPilot`, branch `main`.
4. Render shows what it will create. You should see exactly three:

   | Name | What it is |
   |---|---|
   | `bizpilot-redis` | Key Value store, free |
   | `bizpilot-api` | The NestJS API, free |
   | `bizpilot-web` | The React app, static (always free) |

5. It asks you to fill in the values marked "sync: false". Fill in **only these
   two**, from step 1:

   | Key | Paste |
   |---|---|
   | `DATABASE_URL` | the **pooled** string (`-pooler` in the host) |
   | `DIRECT_URL` | the **direct** string (no `-pooler`) |

   Leave everything else blank. Blanks are safe — the app runs without the
   assistant and without payments, and two of the remaining values do not exist
   yet.

6. Click **Apply**.

The first build takes 5–10 minutes. The API will fail its health check on this
first pass — expected, it has no `WEB_URL` yet. Carry on.

> **If Render says a name is taken**, it appends a suffix — you might get
> `bizpilot-api-a4f2`. Fine, just use *your* actual URLs everywhere below
> instead of the example ones.

---

## 3. Write down your two URLs

From the Render dashboard, open each service and copy the URL at the top:

- API: `https://bizpilot-api.onrender.com`
- Web: `https://bizpilot-web.onrender.com`

Yours will differ if step 2 gave you a suffix. Every step below uses these two.

---

## 4. Wire the two services to each other

They cannot know each other's addresses until both exist, which is why this is
manual.

**On `bizpilot-api`** → Environment → add or edit:

| Key | Value |
|---|---|
| `WEB_URL` | `https://bizpilot-web.onrender.com` |
| `CORS_ORIGINS` | `https://bizpilot-web.onrender.com` |

No trailing slash on either. `CORS_ORIGINS` must match the browser's address
exactly or every request from the app is blocked.

**On `bizpilot-web`** → Environment:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://bizpilot-api.onrender.com/api` |

Note the `/api` on the end — that one does need it.

Saving the API's variables restarts it automatically. The web app does **not**
update itself: `VITE_API_URL` is baked in when the site is built, so go to
`bizpilot-web` → **Manual Deploy** → **Deploy latest commit**.

---

## 5. Claim your platform admin account

Do this now, before you share the link with anyone. The platform dashboard —
your MRR, and every shop's turnover — is unlocked by matching an email address.
If the address you nominate has no account yet, whoever registers it first gets
in.

1. `bizpilot-api` → Environment → set:

   | Key | Value |
   |---|---|
   | `PLATFORM_ADMIN_EMAILS` | your email, e.g. `smbabazipatrick@gmail.com` |

   Several are allowed, comma-separated. Blank means nobody, which is the safe
   default.

2. Wait for the API to restart (about a minute).
3. Go to your web URL, click **Start free**, and register **using that exact
   email address**.
4. Log in. You should see a **Platform** item at the bottom of the sidebar.

If you do not see it, the email does not match — check for a typo or a stray
space, and that the API finished restarting.

---

## 6. Check it actually works

1. Open `https://bizpilot-api.onrender.com/api/health` in a browser. You want:

   ```json
   { "status": "ok", "database": "up", "cache": "up" }
   ```

   If `database` or `cache` is not `up`, see the troubleshooting table below.

2. Open your web URL. The landing page should load with the drifting shop
   scenes behind the headline.

3. Log in, add one product, record one sale. The dashboard should show it.

That is a live product.

---

## 7. Optional extras

None of these are needed to run. Add them when you want the feature.

**The AI assistant.** Create a key at
[console.anthropic.com](https://console.anthropic.com), then set
`ANTHROPIC_API_KEY` on `bizpilot-api`. One key serves every shop — owners never
supply their own. Until you set it, the Assistant screen says so politely.

Watch the cost. On `claude-opus-5` with the Starter plan's 300-question monthly
allowance, this is the one feature that can cost more than the RWF 7,000 you
charge. The Platform dashboard shows an estimate; check it against a real
Anthropic invoice in month one, and switch `ANTHROPIC_MODEL` to
`claude-sonnet-5` if the numbers do not work.

**Taking payments.** From the Flutterwave dashboard set `FLUTTERWAVE_PUBLIC_KEY`
and `FLUTTERWAVE_SECRET_KEY`. Then invent a long random string, set it as
`FLUTTERWAVE_WEBHOOK_HASH`, and paste the same value into Flutterwave →
Settings → Webhooks → *Secret hash*. Point their webhook URL at:

```
https://bizpilot-api.onrender.com/api/webhooks/flutterwave
```

Use the **test** keys until you have taken a real order end to end.

**Real SMS.** Get an Africa's Talking account, set `AFRICASTALKING_USERNAME` and
`AFRICASTALKING_API_KEY`, and change `SMS_PROVIDER` from `log` to
`africastalking`. On `log` the messages are written to the API log instead of
being sent, which is what you want while testing.

---

## 8. Before a real shop trusts it

The free tier is genuinely fine for a demo. The moment somebody's real takings
are in it, these stop being optional:

1. **Turn on backups.** Using Neon means the database is no longer deleted after
   30 days, which was the big one — but *not being deleted* is not the same as
   *being backed up*. Neon's free plan keeps a short restore window; check what
   yours actually is and either upgrade it or schedule your own `pg_dump`. Then
   restore from one once, to prove it works. A backup nobody has restored from
   is not a backup.
2. **Upgrade the API instance** so it stops sleeping. A shopkeeper with a queue
   of customers will not wait 50 seconds, and the overdue-invoice and reminder
   jobs need the service awake to run.
3. **Watch the Neon usage meter.** The free plan has a storage cap and a
   compute-hours budget. BizPilot's data is small — a year of a busy shop is
   megabytes — so compute hours will bite first if traffic grows.
4. **Read [SECURITY.md](SECURITY.md)** and fix at least the top three. Right
   now a successful XSS hands over a 30-day session, there is no password reset,
   and there is no email verification.

---

## Troubleshooting

| What you see | What it is |
|---|---|
| Deploy log: migration fails on an **advisory lock**, or hangs then times out | `DIRECT_URL` is pointing at the pooled endpoint. It must be the host **without** `-pooler`. This is the most common failure of this setup. |
| Deploy log: `Can't reach database server` | Check `DATABASE_URL` was pasted whole — Neon's strings are long and easy to truncate — and that you clicked **Show password** first, so it is the real password and not a row of asterisks. |
| Deploy log complains about an unrecognised parameter, mentioning `channel_binding` | Neon appends `&channel_binding=require` to its strings. If Prisma objects, delete that parameter from both URLs. `sslmode=require` is the one that matters. |
| API deploy fails, log says it cannot reach the **key value store** | Render's private network is per-region. `render.yaml` puts both in `frankfurt`; if you changed one, change both. |
| Everything works but feels slow | Check the Neon project region is Frankfurt, not the US default. |
| Every request from the app fails, console mentions CORS | `CORS_ORIGINS` does not exactly match the web URL. No trailing slash, and `https` not `http`. |
| App loads but nothing saves, network calls 404 | `VITE_API_URL` is missing, or the web site was not rebuilt after you set it. It is baked in at build time — redeploy the static site. |
| `/api/health` says `"cache": "down"` | The Key Value service is still starting, or `REDIS_URL` did not link. Check `bizpilot-redis` is live, then restart the API. |
| First request of the day takes ~50 seconds | The free instance was asleep. Expected. Only an upgrade fixes it. |
| No **Platform** item in the sidebar | Your logged-in email is not in `PLATFORM_ADMIN_EMAILS`, or the API has not restarted since you set it. |
| Deploy fails on `npm ci` | `package-lock.json` is out of step with `package.json`. Run `npm install` locally, commit the lock file, push. |

---

## Updating it later

Push to `main`. Render rebuilds both services automatically, and database
migrations run on API start, so there is nothing manual to do on release.

The exception is anything baked in at build time — `VITE_API_URL` — which needs
a manual redeploy of the static site after you change it.
