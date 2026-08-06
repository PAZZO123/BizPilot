# Putting BizPilot live on Render's free tier

Start to finish, about 25 minutes, most of it waiting for builds.

**Read this first:** the free tier is for showing the product to people, not for
running a real shop's books on. Two things make that true, and neither is a
setting you can change:

- **The free Postgres database is deleted after 30 days.** Everything in it goes
  with it. Section 8 covers what to do about that.
- **The free API instance sleeps after 15 minutes of no traffic** and takes
  roughly 50 seconds to wake. While it sleeps, the scheduled jobs that mark
  invoices overdue and send SMS reminders do not run.

Perfect for a demo, a portfolio link, or letting a shopkeeper try it. Not for
someone's actual takings.

---

## 1. What you need

- The GitHub repo — already pushed to `PAZZO123/BizPilot`.
- A Render account. Sign up at [render.com](https://render.com) with your GitHub
  account; it makes step 2 easier. **No card is required for the free tier.**

Everything else is optional and covered in section 7.

---

## 2. Create the four services

Render reads `render.yaml` and builds all four at once.

1. Render dashboard → **New** → **Blueprint**.
2. Connect your GitHub account if you have not already, and give Render access
   to the **BizPilot** repository.
3. Pick `PAZZO123/BizPilot`, branch `main`.
4. Render shows what it will create. You should see exactly four:

   | Name | What it is |
   |---|---|
   | `bizpilot-db` | PostgreSQL 16, free |
   | `bizpilot-redis` | Key Value store, free |
   | `bizpilot-api` | The NestJS API, free |
   | `bizpilot-web` | The React app, static (always free) |

5. It will ask you to fill in the values marked "sync: false". **Leave them all
   blank for now** — two of them do not exist yet, and blanks are safe: the app
   simply runs without the assistant and without payments.
6. Click **Apply**.

The first build takes 5–10 minutes. The API will fail its health check on this
first pass — that is expected, it has no `WEB_URL` yet. Carry on.

> **If Render says a name is taken**, it appends a suffix — you might get
> `bizpilot-api-a4f2`. That is fine, just use *your* actual URLs everywhere
> below instead of the example ones.

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

1. **Upgrade the database.** The free one is deleted after 30 days. This is the
   one that loses a shop's books. Render's paid Postgres also gives you daily
   backups — turn them on, and restore one once to prove it works.
2. **Upgrade the API instance** so it stops sleeping. A shopkeeper with a queue
   of customers will not wait 50 seconds, and the overdue-invoice and reminder
   jobs need the service awake to run.
3. **Read [SECURITY.md](SECURITY.md)** and fix at least the top three. Right
   now a successful XSS hands over a 30-day session, there is no password reset,
   and there is no email verification.

---

## Troubleshooting

| What you see | What it is |
|---|---|
| API deploy fails, log says it cannot reach the database | Everything must be in one region. `render.yaml` puts all three in `frankfurt`; if you changed one, change them all. |
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
